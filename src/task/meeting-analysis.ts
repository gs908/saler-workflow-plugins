import { CozeAPI } from '@coze/api';
import { cozeConfig, validateCozeConfig } from '../config/coze.config';
import { HttpClient } from '../utils/http-client';

/**
 * 工作流执行参数
 */
export interface WorkflowExecuteParams {
  meetingName: string;
  txtUrl?: string;
  fileId?: string;
  fileName?: string;
}

/**
 * Coze API 工作流执行响应（异步执行）
 * 参考: https://www.coze.cn/docs/developer_guides/workflow_run
 */
export interface WorkflowExecuteResponse {
  /** 调用状态码，0 表示成功 */
  code: number;
  /** 状态信息，code 不为 0 时包含错误详情 */
  msg: string;
  /** 异步执行的事件 ID */
  execute_id: string;
  /** 工作流试运行调试页面 URL，有效期 7 天 */
  debug_url: string;
  /** 工作流执行结果，通常为 JSON 序列化字符串 */
  data?: string;
  /** 请求的详细信息，包含 logid 用于排查问题 */
  detail?: {
    logid: string;
    [key: string]: unknown;
  };
  /** 中断事件的详细信息 */
  interrupt_data?: {
    data: string;
    type: number;
    event_id: string;
    required_parameters?: Record<string, unknown>;
  };
  /** 资源使用情况 */
  usage?: {
    token_count?: number;
    [key: string]: unknown;
  };
}

/**
 * 工作流运行历史查询结果
 */
export interface WorkflowRunHistory {
  executeId: string;
  workflowId: string;
  status: 'running' | 'success' | 'failed' | 'completed';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * Coze 服务客户端
 */
export class CozeServiceClient {
  private apiClient: CozeAPI;
  private httpClient: HttpClient;

  constructor() {
    // 验证配置
    validateCozeConfig();

    // 初始化 Coze SDK 客户端
    this.apiClient = new CozeAPI({
      token: cozeConfig.token,
      baseURL: cozeConfig.baseURL,
    });

    // 初始化 HTTP 客户端（用于查询运行历史等 REST API）
    this.httpClient = new HttpClient({
      baseURL: cozeConfig.baseURL,
      headers: {
        Authorization: `Bearer ${cozeConfig.token}`,
      },
    });
  }

  /**
   * 执行会议分析工作流
   * @param params - 工作流参数
   * @returns Coze API 原始响应，包含 execute_id、debug_url 等
   */
  async executeMeetingAnalysisWorkflow(
    params: WorkflowExecuteParams
  ): Promise<WorkflowExecuteResponse> {
    const { meetingName, txtUrl, fileId, fileName } = params;

    console.log(`[CozeService] 开始执行会议分析工作流: ${meetingName}`);

    try {
      // 支持两种格式：file_id + file_name 或 url
      const parameters: Record<string, unknown> = { meetingName };
      if (fileId) {
        parameters.recordFile = fileName
          ? { file_id: fileId, file_name: fileName }
          : { file_id: fileId };
      } else if (txtUrl) {
        parameters.url = txtUrl;
      }
      console.log('Check params:',JSON.stringify(parameters, null, 2))
      const response = await this.apiClient.workflows.runs.create({
        workflow_id: cozeConfig.workflows.meetingAnalysis.workflowId,
        is_async: cozeConfig.workflows.meetingAnalysis.isAsync,
        parameters,
      });

      // SDK 返回的数据即为 Coze API 标准响应格式
      const responseData = response as unknown as WorkflowExecuteResponse;

      console.log(`[CozeService] 工作流执行响应: code=${responseData.code}, execute_id=${responseData.execute_id}`);

      // 检查调用是否成功
      if (responseData.code !== 0) {
        throw new Error(`Coze API 调用失败: ${responseData.msg || `错误码 ${responseData.code}`}`);
      }

      return responseData;
    } catch (error) {
      console.error('[CozeService] 工作流执行失败:', error);
      throw new Error(
        `执行会议分析工作流失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 查询工作流执行结果
   * @param workflowId - 工作流 ID
   * @param executeId - 执行 ID
   * @returns 工作流运行历史详情
   */
  async getWorkflowRunHistory(
    workflowId: string,
    executeId: string
  ): Promise<WorkflowRunHistory> {
    console.log(`[CozeService] 查询工作流执行结果: workflowId=${workflowId}, executeId=${executeId}`);

    try {
      // 使用 REST API 查询运行历史
      const url = `/v1/workflows/${workflowId}/run_histories/${executeId}`;
      const response = await this.httpClient.get<{
        code: number;
        msg: string;
        data?: WorkflowRunHistory;
      }>(url);

      if (response.code !== 0 || !response.data) {
        throw new Error(response.msg || '查询执行结果失败');
      }

      console.log(`[CozeService] 查询成功, 状态: ${response.data.status}`);

      return {
        ...response.data,
        executeId,
        workflowId,
      };
    } catch (error) {
      console.error('[CozeService] 查询执行结果失败:', error);
      throw new Error(
        `查询工作流执行结果失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 上传文件到 Coze
   * @param filePath - 文件路径
   * @returns 上传后的文件信息 { id, file_name, bytes, created_at }
   */
  async uploadFile(filePath: string): Promise<{
    id: string;
    file_name: string;
    bytes: number;
    created_at: number;
  }> {
    console.log(`[CozeService] 上传文件: ${filePath}`);

    const FormData = require('form-data');
    const fs = require('fs');
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    return new Promise((resolve, reject) => {
      const url = `${cozeConfig.baseURL}/v1/files/upload`;
      const request = require('https').request(
        {
          method: 'POST',
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${cozeConfig.token}`,
          },
          hostname: new URL(cozeConfig.baseURL).hostname,
          path: '/v1/files/upload',
        },
        (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => {
            try {
              const response = JSON.parse(data);
              if (response.code !== 0) {
                reject(new Error(response.msg || '文件上传失败'));
                return;
              }
              console.log(`[CozeService] 文件上传成功: ${response.data.id}`);
              resolve(response.data);
            } catch (e) {
              reject(new Error('解析上传响应失败'));
            }
          });
        }
      );
      request.on('error', reject);
      form.pipe(request);
    });
  }

  /**
   * 轮询等待工作流执行完成
   * @param workflowId - 工作流 ID
   * @param executeId - 执行 ID
   * @param options - 轮询配置选项
   * @returns 最终执行结果
   */
  async waitForWorkflowCompletion(
    workflowId: string,
    executeId: string,
    options: {
      maxAttempts?: number;
      interval?: number;
    } = {}
  ): Promise<WorkflowRunHistory> {
    const { maxAttempts = 30, interval = 2000 } = options;

    console.log(`[CozeService] 开始轮询工作流执行状态: maxAttempts=${maxAttempts}, executeId=${executeId}`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.getWorkflowRunHistory(workflowId, executeId);

      // 如果状态已完成或失败，直接返回
      if (result.status === 'success' || result.status === 'completed' || result.status === 'failed') {
        console.log(`[CozeService] 工作流执行${result.status}, 共轮询 ${attempt} 次`);
        return result;
      }

      console.log(`[CozeService] 第 ${attempt} 次轮询, 状态: ${result.status}, 等待 ${interval}ms...`);

      // 等待后继续轮询
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`工作流执行超时，已轮询 ${maxAttempts} 次`);
  }
}

/**
 * 默认的 Coze 服务客户端实例
 */
export const cozeService = new CozeServiceClient();

/**
 * 便捷函数：执行会议分析工作流
 * @param meetingName - 会议名称
 * @param txtUrl - 文本文件 URL（fileId 存在时此参数忽略）
 * @param fileId - 上传后的文件 ID
 * @returns Coze API 原始响应，包含 execute_id、debug_url 等
 */
export async function executeMeetingAnalysis(
  meetingName: string,
  txtUrl?: string,
  fileId?: string,
  fileName?: string
): Promise<WorkflowExecuteResponse> {
  return cozeService.executeMeetingAnalysisWorkflow({ meetingName, txtUrl, fileId, fileName });
}

/**
 * 便捷函数：上传文件到 Coze
 * @param filePath - 文件路径
 * @returns 上传后的文件信息
 */
export async function uploadFileToCoze(
  filePath: string
): Promise<{ id: string; file_name: string; bytes: number; created_at: number }> {
  return cozeService.uploadFile(filePath);
}

/**
 * 便捷函数：查询工作流执行结果
 * @param workflowId - 工作流 ID
 * @param executeId - 执行 ID
 * @returns 工作流运行历史详情
 */
export async function getWorkflowResult(
  workflowId: string,
  executeId: string
): Promise<WorkflowRunHistory> {
  return cozeService.getWorkflowRunHistory(workflowId, executeId);
}

/**
 * 便捷函数：执行会议分析并等待完成
 * @param meetingName - 会议名称
 * @param txtUrl - 文本文件 URL（fileId 存在时此参数忽略）
 * @param fileId - 上传后的文件 ID
 * @param fileName - 上传后的文件名
 * @param options - 轮询配置选项
 * @returns 最终执行结果
 */
export async function executeMeetingAnalysisAndWait(
  meetingName: string,
  txtUrl?: string,
  fileId?: string,
  fileName?: string,
  options?: {
    maxAttempts?: number;
    interval?: number;
  }
): Promise<WorkflowRunHistory> {
  const executeResult = await executeMeetingAnalysis(meetingName, txtUrl, fileId, fileName);
  const workflowId = cozeConfig.workflows.meetingAnalysis.workflowId;
  return cozeService.waitForWorkflowCompletion(
    workflowId,
    executeResult.execute_id,
    options
  );
}
