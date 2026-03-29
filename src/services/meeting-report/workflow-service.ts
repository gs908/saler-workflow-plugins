import { CozeBaseClient, createConfigFromGlobal } from './coze-client';
import { CozeServiceError, CozeWorkflowError } from './errors';
import { 
  WorkflowExecuteParams, 
  WorkflowExecuteResponse, 
  WorkflowRunHistory,
  Logger 
} from './types';

/**
 * 工作流服务
 * 负责会议分析工作流的执行和查询
 */
export class WorkflowService extends CozeBaseClient {
  constructor(config = createConfigFromGlobal(), logger?: Logger) {
    super(config, logger);
  }

  /**
   * 校验工作流执行参数
   */
  private validateExecuteParams(params: WorkflowExecuteParams): void {
    const { meetingName, txtUrl, fileId } = params;

    if (!meetingName?.trim()) {
      throw new CozeServiceError('会议名称 (meetingName) 是必填参数');
    }

    if (!txtUrl && !fileId) {
      throw new CozeServiceError('必须提供 txtUrl 或 fileId 之一');
    }
  }

  /**
   * 构建工作流参数
   */
  private buildWorkflowParameters(params: WorkflowExecuteParams): Record<string, unknown> {
    const { meetingName, txtUrl, fileId, fileName } = params;
    const parameters: Record<string, unknown> = { meetingName: meetingName.trim() };

    if (fileId) {
      parameters.recordFile = fileName
        ? { file_id: fileId, file_name: fileName }
        : { file_id: fileId };
      
      if (!fileName) {
        this.logger.warn('[WorkflowService] 警告: 提供了 fileId 但未提供 fileName');
      }
    } else if (txtUrl) {
      parameters.url = txtUrl;
    }

    return parameters;
  }

  /**
   * 执行会议分析工作流
   * @param params - 工作流参数
   * @returns Coze API 原始响应，包含 execute_id、debug_url 等
   */
  async executeWorkflow(params: WorkflowExecuteParams): Promise<WorkflowExecuteResponse> {
    // 前置校验
    this.validateExecuteParams(params);

    const { meetingName } = params;
    this.logger.info(`[WorkflowService] 开始执行会议分析工作流: ${meetingName}`);

    try {
      const parameters = this.buildWorkflowParameters(params);
      
      const response = await this.apiClient.workflows.runs.create({
        workflow_id: this.config.workflowId,
        is_async: this.config.isAsync,
        parameters,
      });

      // SDK 返回的数据即为 Coze API 标准响应格式
      const responseData = response as unknown as WorkflowExecuteResponse;

      this.logger.info(
        `[WorkflowService] 工作流执行响应: code=${responseData.code}, execute_id=${responseData.execute_id}`
      );

      // 检查调用是否成功
      if (responseData.code !== 0) {
        throw new CozeWorkflowError(
          `Coze API 调用失败: ${responseData.msg || `错误码 ${responseData.code}`}`,
          undefined,
          this.config.workflowId,
          responseData.execute_id
        );
      }

      return responseData;
    } catch (error) {
      this.logger.error('[WorkflowService] 工作流执行失败:', error);
      
      // 如果已经是 CozeServiceError，直接抛出
      if (error instanceof CozeServiceError) {
        throw error;
      }
      
      // 包装其他错误，保留原始错误
      throw new CozeWorkflowError(
        `执行会议分析工作流失败: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
        this.config.workflowId
      );
    }
  }

  /**
   * 查询工作流执行结果
   * @param workflowId - 工作流 ID
   * @param executeId - 执行 ID
   * @returns 工作流运行历史详情
   */
  async getWorkflowHistory(
    workflowId: string,
    executeId: string
  ): Promise<WorkflowRunHistory> {
    this.logger.info(
      `[WorkflowService] 查询工作流执行结果: workflowId=${workflowId}, executeId=${executeId}`
    );

    try {
      // 使用 REST API 查询运行历史
      const url = `/v1/workflows/${workflowId}/run_histories/${executeId}`;
      const response = await this.httpClient.get<{
        code: number;
        msg: string;
        data?: WorkflowRunHistory;
      }>(url);

      if (response.code !== 0 || !response.data) {
        throw new CozeWorkflowError(
          response.msg || '查询执行结果失败',
          undefined,
          workflowId,
          executeId
        );
      }

      this.logger.info(`[WorkflowService] 查询成功, 状态: ${response.data.status}`);

      return {
        ...response.data,
        executeId,
        workflowId,
      };
    } catch (error) {
      this.logger.error('[WorkflowService] 查询执行结果失败:', error);
      
      if (error instanceof CozeServiceError) {
        throw error;
      }
      
      throw new CozeWorkflowError(
        `查询工作流执行结果失败: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
        workflowId,
        executeId
      );
    }
  }

  /**
   * 从工作流结果中提取 markdown 内容
   * @param result - 工作流运行历史结果
   * @returns markdown 内容字符串，未找到返回 null
   */
  extractMarkdownContent(result: WorkflowRunHistory): string | null {
    const output = result.output;
    if (!output) {
      this.logger.warn('[WorkflowService] 工作流结果中没有 output 数据');
      return null;
    }

    // 尝试各种可能的字段名（按优先级排序）
    const possibleFields = [
      'markdown',      // 最可能的字段名
      'content',       // 通用内容字段
      'text',          // 文本字段
      'result',        // 结果字段
      'data',          // 数据字段
      'output',        // 输出字段
      'analysis',      // 分析结果
      'response',      // 响应内容
    ];

    for (const field of possibleFields) {
      const value = output[field];
      if (typeof value === 'string' && value.trim()) {
        this.logger.debug(`[WorkflowService] 从字段 "${field}" 提取到内容`);
        return value.trim();
      }
    }

    // 如果 output 本身就是字符串
    if (typeof output === 'string') {
      return (output as string).trim();
    }

    // 尝试将 output 转为 JSON 字符串
    try {
      const jsonStr = JSON.stringify(output);
      if (jsonStr && jsonStr !== '{}' && jsonStr !== '[]') {
        this.logger.warn('[WorkflowService] 未找到标准字段，返回完整 output JSON');
        return jsonStr;
      }
    } catch {
      // 忽略序列化错误
    }

    this.logger.warn('[WorkflowService] 无法从工作流结果中提取有效内容');
    return null;
  }
}
