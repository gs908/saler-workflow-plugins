import { FileService } from './file-service';
import { WorkflowService } from './workflow-service';
import { PollingService } from './polling-service';
import { CallbackService, CallbackConfig } from './callback-service';
import { createConfigFromGlobal } from './coze-client';
import { CozeServiceError, CozeWorkflowError } from './errors';
import { Logger, FileUploadResult, WorkflowRunHistory } from './types';

/**
 * 会议处理配置
 */
export interface MeetingProcessorConfig {
  /** 轮询首次延迟（分钟），默认从 .env 读取 */
  initialDelay?: number;
  /** 轮询间隔（秒），默认从 .env 读取 */
  pollInterval?: number;
  /** 最大轮询次数，默认从 .env 读取 */
  maxPollAttempts?: number;
  /** 回调配置 */
  callback?: CallbackConfig;
}

/**
 * 会议处理结果
 */
export interface MeetingProcessResult {
  /** 执行 ID */
  executeId: string;
  /** 文件上传结果 */
  fileUpload?: FileUploadResult;
  /** 工作流最终结果 */
  workflowResult?: WorkflowRunHistory;
  /** 提取的分析内容 */
  analysisContent?: string | null;
  /** 回调推送结果 */
  callbackPushed: boolean;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 会议处理器
 * 编排完整的会议分析流程：上传 → 提交工作流 → 轮询 → 推送回调
 */
export class MeetingProcessor {
  private fileService: FileService;
  private workflowService: WorkflowService;
  private pollingService: PollingService;
  private callbackService?: CallbackService;
  private logger: Logger;

  constructor(
    private config: MeetingProcessorConfig = {},
    logger?: Logger
  ) {
    // 初始化各服务
    const cozeConfig = createConfigFromGlobal();
    this.fileService = new FileService(cozeConfig, logger);
    this.workflowService = new WorkflowService(cozeConfig, logger);
    this.pollingService = new PollingService(cozeConfig, logger);

    // 初始化回调服务（优先使用显式配置，否则尝试读取环境变量）
    const callbackConfig = config.callback || this.getDefaultCallbackConfig();
    if (callbackConfig) {
      this.callbackService = new CallbackService(callbackConfig, logger);
    }

    // 日志
    this.logger = logger || {
      debug: () => {},
      info: console.log,
      warn: console.warn,
      error: console.error,
    };

    // 从全局配置获取轮询默认值
    this.defaultPollingConfig = cozeConfig.polling || {
      initialDelay: 5 * 60 * 1000,
      interval: 30 * 1000,
      maxAttempts: 60,
    };
  }

  private defaultPollingConfig: {
    initialDelay: number;
    interval: number;
    maxAttempts: number;
  };

  /**
   * 获取默认回调配置（从环境变量读取）
   */
  private getDefaultCallbackConfig(): CallbackConfig | undefined {
    const callbackUrl = process.env.SALER_REPORT_CALLBACK_URL;
    
    if (callbackUrl?.trim()) {
      return {
        url: callbackUrl.trim(),
        secret: process.env.SALER_REPORT_CALLBACK_SECRET,
        timeout: process.env.SALER_REPORT_CALLBACK_TIMEOUT 
          ? parseInt(process.env.SALER_REPORT_CALLBACK_TIMEOUT, 10) 
          : 30000,
      };
    }
    
    return undefined;
  }

  /**
   * 处理会议文件（完整流程）
   * @param filePath - 本地文件路径
   * @param meetingName - 会议名称
   * @param signal - 取消信号（可选）
   * @returns 处理结果
   */
  async process(
    filePath: string,
    meetingName: string,
    signal?: AbortSignal
  ): Promise<MeetingProcessResult> {
    const result: MeetingProcessResult = {
      executeId: '',
      callbackPushed: false,
      success: false,
    };

    try {
      // 步骤 1: 上传文件到 Coze
      this.logger.info(`[MeetingProcessor] 开始处理会议: ${meetingName}`);
      const uploadResult = await this.fileService.uploadFile(filePath);
      result.fileUpload = uploadResult;
      this.logger.info(`[MeetingProcessor] 文件上传成功: ${uploadResult.id}`);

      // 步骤 2: 提交工作流
      const workflowResult = await this.workflowService.executeWorkflow({
        meetingName,
        fileId: uploadResult.id,
        fileName: uploadResult.file_name,
      });
      result.executeId = workflowResult.execute_id;
      this.logger.info(
        `[MeetingProcessor] 工作流提交成功: execute_id=${workflowResult.execute_id}`
      );

      // 步骤 3: 轮询等待工作流完成
      const pollConfig = {
        initialDelay: this.config.initialDelay ?? this.defaultPollingConfig.initialDelay,
        interval: this.config.pollInterval ?? this.defaultPollingConfig.interval,
        maxAttempts: this.config.maxPollAttempts ?? this.defaultPollingConfig.maxAttempts,
        signal,
      };

      this.logger.info(
        `[MeetingProcessor] 开始轮询: initialDelay=${pollConfig.initialDelay}ms, interval=${pollConfig.interval}ms, maxAttempts=${pollConfig.maxAttempts}`
      );

      const finalResult = await this.pollingService.waitForCompletion(
        this.workflowService.getConfig().workflowId,
        workflowResult.execute_id,
        pollConfig
      );

      result.workflowResult = finalResult;
      this.logger.info(
        `[MeetingProcessor] 工作流完成: status=${finalResult.status}`
      );

      // 步骤 4: 提取分析内容
      const analysisContent = this.workflowService.extractMarkdownContent(finalResult);
      result.analysisContent = analysisContent;

      if (analysisContent) {
        this.logger.info(
          `[MeetingProcessor] 提取到分析内容: ${analysisContent.length} 字符`
        );
      } else {
        this.logger.warn('[MeetingProcessor] 未提取到分析内容');
      }

      // 步骤 5: 推送回调（如果配置了回调）
      if (this.callbackService) {
        try {
          await this.callbackService.pushAnalysisCallback(
            workflowResult.execute_id,
            finalResult,
            this.workflowService
          );
          result.callbackPushed = true;
          this.logger.info('[MeetingProcessor] 回调推送成功');
        } catch (callbackError) {
          this.logger.error('[MeetingProcessor] 回调推送失败:', callbackError);
          // 回调失败不标记整体失败，但记录错误
        }
      } else {
        this.logger.info('[MeetingProcessor] 未配置回调，跳过推送');
      }

      result.success = true;
      return result;
    } catch (error) {
      this.logger.error('[MeetingProcessor] 处理失败:', error);

      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);

      // 如果是取消错误，特殊处理
      if (error instanceof CozeServiceError && error.message === '轮询已取消') {
        result.error = '用户取消';
      }

      return result;
    }
  }

  /**
   * 处理会议文件（简化版，直接使用已知的 fileId）
   * @param fileId - 已上传的文件 ID
   * @param fileName - 文件名
   * @param meetingName - 会议名称
   * @param signal - 取消信号（可选）
   * @returns 处理结果
   */
  async processWithFileId(
    fileId: string,
    fileName: string,
    meetingName: string,
    signal?: AbortSignal
  ): Promise<MeetingProcessResult> {
    const result: MeetingProcessResult = {
      executeId: '',
      callbackPushed: false,
      success: false,
    };

    try {
      // 跳过上传，直接提交工作流
      this.logger.info(`[MeetingProcessor] 使用已有文件处理会议: ${meetingName}`);

      const workflowResult = await this.workflowService.executeWorkflow({
        meetingName,
        fileId,
        fileName,
      });
      result.executeId = workflowResult.execute_id;
      this.logger.info(
        `[MeetingProcessor] 工作流提交成功: execute_id=${workflowResult.execute_id}`
      );

      // 轮询等待
      const pollConfig = {
        initialDelay: this.config.initialDelay ?? this.defaultPollingConfig.initialDelay,
        interval: this.config.pollInterval ?? this.defaultPollingConfig.interval,
        maxAttempts: this.config.maxPollAttempts ?? this.defaultPollingConfig.maxAttempts,
        signal,
      };

      const finalResult = await this.pollingService.waitForCompletion(
        this.workflowService.getConfig().workflowId,
        workflowResult.execute_id,
        pollConfig
      );

      result.workflowResult = finalResult;

      // 提取内容
      const analysisContent = this.workflowService.extractMarkdownContent(finalResult);
      result.analysisContent = analysisContent;

      // 推送回调
      if (this.callbackService) {
        try {
          await this.callbackService.pushAnalysisCallback(
            workflowResult.execute_id,
            finalResult,
            this.workflowService
          );
          result.callbackPushed = true;
        } catch (callbackError) {
          this.logger.error('[MeetingProcessor] 回调推送失败:', callbackError);
        }
      }

      result.success = true;
      return result;
    } catch (error) {
      this.logger.error('[MeetingProcessor] 处理失败:', error);
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * 在后台等待工作流完成并推送回调
   * @param executeId - 执行 ID
   * @param signal - 取消信号
   */
  async waitAndPushCallback(
    executeId: string,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      this.logger.info(`[MeetingProcessor] 开始后台等待: executeId=${executeId}`);

      const pollConfig = {
        initialDelay: this.config.initialDelay ?? this.defaultPollingConfig.initialDelay,
        interval: this.config.pollInterval ?? this.defaultPollingConfig.interval,
        maxAttempts: this.config.maxPollAttempts ?? this.defaultPollingConfig.maxAttempts,
        signal,
      };

      const finalResult = await this.pollingService.waitForCompletion(
        this.workflowService.getConfig().workflowId,
        executeId,
        pollConfig
      );

      const analysisContent = this.workflowService.extractMarkdownContent(finalResult);

      if (this.callbackService) {
        await this.callbackService.pushAnalysisCallback(
          executeId,
          finalResult,
          this.workflowService
        );
        this.logger.info(`[MeetingProcessor] 回调推送完成: executeId=${executeId}`);
      } else {
        this.logger.info(`[MeetingProcessor] 等待完成（无回调）: executeId=${executeId}, status=${finalResult.status}, content=${analysisContent?.length ?? 0} 字符`);
      }
    } catch (err) {
      this.logger.error(`[MeetingProcessor] 后台等待失败: executeId=${executeId}`, err);
    }
  }

  /**
   * 查询并推送回调（用于已存在的工作流）
   * @param executeId - 执行 ID
   * @returns 处理结果
   */
  async queryAndPushCallback(executeId: string): Promise<MeetingProcessResult> {
    const result: MeetingProcessResult = {
      executeId,
      callbackPushed: false,
      success: false,
    };

    try {
      this.logger.info(`[MeetingProcessor] 查询已存在的工作流: ${executeId}`);

      // 查询工作流结果
      const workflowResult = await this.workflowService.getWorkflowHistory(
        this.workflowService.getConfig().workflowId,
        executeId
      );

      result.workflowResult = workflowResult;
      this.logger.info(`[MeetingProcessor] 查询成功: status=${workflowResult.status}`);

      // 提取内容
      const analysisContent = this.workflowService.extractMarkdownContent(workflowResult);
      result.analysisContent = analysisContent;

      // 推送回调
      if (this.callbackService) {
        try {
          await this.callbackService.pushAnalysisCallback(
            executeId,
            workflowResult,
            this.workflowService
          );
          result.callbackPushed = true;
          result.success = true;
          this.logger.info('[MeetingProcessor] 回调推送成功');
        } catch (callbackError) {
          this.logger.error('[MeetingProcessor] 回调推送失败:', callbackError);
          result.error = callbackError instanceof Error ? callbackError.message : String(callbackError);
        }
      } else {
        result.success = true;
        this.logger.info('[MeetingProcessor] 未配置回调服务');
      }

      return result;
    } catch (error) {
      this.logger.error('[MeetingProcessor] 查询失败:', error);
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }
}
