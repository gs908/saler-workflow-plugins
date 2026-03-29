import { HttpClient } from '../../utils/http-client';
import { CozeServiceError } from './errors';
import { WorkflowRunHistory, Logger } from './types';
import { WorkflowService } from './workflow-service';

/**
 * 回调配置
 */
export interface CallbackConfig {
  /** 回调地址，如 http://ai-backend/api/presales-video/workflow-callback */
  url: string;
  /** 可选密钥 */
  secret?: string;
  /** 超时时间（毫秒），默认 30000 */
  timeout?: number;
}

/**
 * 回调服务
 * 负责将工作流完成结果推送到回调地址
 */
export class CallbackService {
  private httpClient: HttpClient;
  protected logger: Logger;

  constructor(
    private config: CallbackConfig,
    logger?: Logger
  ) {
    this.httpClient = new HttpClient({
      timeout: config.timeout || 30000,
    });
    // 如果未提供 logger，使用简单实现
    this.logger = logger || {
      debug: () => {},
      info: console.log,
      warn: console.warn,
      error: console.error,
    };
  }

  /**
   * 推送工作流完成回调（分析内容类型）
   * @param executeId - 执行 ID
   * @param result - 工作流运行历史结果
   * @param workflowService - 工作流服务实例（用于提取内容）
   * @returns 推送成功返回 true
   */
  async pushAnalysisCallback(
    executeId: string,
    result: WorkflowRunHistory,
    workflowService: WorkflowService
  ): Promise<boolean> {
    this.logger.info(`[CallbackService] 推送分析内容回调: executeId=${executeId}`);

    // 提取 markdown 内容
    const content = workflowService.extractMarkdownContent(result);

    if (!content) {
      this.logger.warn(`[CallbackService] 未提取到有效内容: executeId=${executeId}`);
      // 仍然推送回调，但 content 为空
    }

    // 构建回调 payload
    // 参考 workflow-callback.md，支持多种字段名以确保兼容性
    const payload: Record<string, unknown> = {
      type: 'analysis_content',
      id: executeId,
      execute_id: executeId,
    };

    // 添加内容字段（支持多种字段名）
    if (content) {
      payload.content = content;
      payload.text = content;        // 备用字段
      payload.result = content;      // 备用字段
    }

    // 添加工作流状态信息
    payload.status = result.status;
    if (result.error) {
      payload.error = result.error;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // 添加密钥（如果配置了）
      if (this.config.secret) {
        headers['X-Presales-Video-Callback-Secret'] = this.config.secret;
        this.logger.debug('[CallbackService] 已添加回调密钥到 Header');
      }

      this.logger.info(`[CallbackService] POST ${this.config.url}`);

      const response = await this.httpClient.post<{
        success: boolean;
        data?: unknown;
        error?: string;
        code?: string;
      }>(this.config.url, payload, { headers });

      if (!response.success) {
        throw new CozeServiceError(
          `回调推送失败: ${response.error || '未知错误'}`,
          undefined,
          { code: response.code }
        );
      }

      this.logger.info(`[CallbackService] 回调推送成功: executeId=${executeId}`);
      return true;
    } catch (error) {
      this.logger.error('[CallbackService] 回调推送失败:', error);

      if (error instanceof CozeServiceError) {
        throw error;
      }

      throw new CozeServiceError(
        `回调推送失败: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 推送视频生成完成回调
   * @param executeId - 执行 ID
   * @param videoUrl - 视频地址
   * @returns 推送成功返回 true
   */
  async pushVideoCallback(executeId: string, videoUrl: string): Promise<boolean> {
    this.logger.info(`[CallbackService] 推送视频回调: executeId=${executeId}, url=${videoUrl}`);

    const payload = {
      type: 'video_create',
      id: executeId,
      execute_id: executeId,
      url: videoUrl,
      path: videoUrl,        // 备用字段
      video_url: videoUrl,   // 备用字段
      videoUrl: videoUrl,    // 备用字段（驼峰）
    };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.config.secret) {
        headers['X-Presales-Video-Callback-Secret'] = this.config.secret;
      }

      const response = await this.httpClient.post<{
        success: boolean;
        data?: unknown;
        error?: string;
        code?: string;
      }>(this.config.url, payload, { headers });

      if (!response.success) {
        throw new CozeServiceError(
          `视频回调推送失败: ${response.error || '未知错误'}`,
          undefined,
          { code: response.code }
        );
      }

      this.logger.info(`[CallbackService] 视频回调推送成功: executeId=${executeId}`);
      return true;
    } catch (error) {
      this.logger.error('[CallbackService] 视频回调推送失败:', error);

      if (error instanceof CozeServiceError) {
        throw error;
      }

      throw new CozeServiceError(
        `视频回调推送失败: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }
}
