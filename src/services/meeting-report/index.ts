/**
 * Meeting Report Service - Coze 工作流服务
 * 
 * 提供会议分析相关的 Coze 工作流执行、文件上传和轮询功能
 * 
 * @example
 * ```typescript
 * // 使用独立服务
 * import { WorkflowService, FileService, PollingService } from './meeting-report';
 * 
 * const workflow = new WorkflowService();
 * const result = await workflow.executeWorkflow({
 *   meetingName: '项目复盘会议',
 *   fileId: 'file_xxx'
 * });
 * 
 * // 使用便捷函数
 * import { executeMeetingAnalysis, uploadFileToCoze } from './meeting-report';
 * 
 * const result = await executeMeetingAnalysis('项目复盘会议', undefined, 'file_xxx');
 * ```
 */

// 错误类
export {
  CozeServiceError,
  CozeConfigError,
  CozeFileUploadError,
  CozeWorkflowError,
} from './errors';

// 类型定义
export type {
  WorkflowExecuteParams,
  WorkflowExecuteResponse,
  WorkflowRunHistory,
  FileUploadResult,
  PollingOptions,
  CozeClientConfig,
  Logger,
} from './types';

export { ConsoleLogger, DebugLogger } from './types';

// 服务类
export { CozeBaseClient, createConfigFromGlobal } from './coze-client';
export { WorkflowService } from './workflow-service';
export { FileService } from './file-service';
export { PollingService } from './polling-service';
export { CallbackService } from './callback-service';
export { MeetingProcessor } from './meeting-processor';

// 回调服务类型
export type { CallbackConfig } from './callback-service';

// 会议处理器类型
export type {
  MeetingProcessorConfig,
  MeetingProcessResult,
} from './meeting-processor';

// ============ 便捷函数（向后兼容）============

import { WorkflowService } from './workflow-service';
import { FileService } from './file-service';
import { PollingService } from './polling-service';
import { WorkflowExecuteParams } from './types';
import { createConfigFromGlobal } from './coze-client';
import { CozeWorkflowError } from './errors';

// 创建默认实例
const defaultWorkflowService = new WorkflowService();
const defaultFileService = new FileService();
const defaultPollingService = new PollingService();

/**
 * 便捷函数：执行会议分析工作流
 * @param meetingName - 会议名称
 * @param txtUrl - 文本文件 URL（fileId 存在时此参数忽略）
 * @param fileId - 上传后的文件 ID
 * @param fileName - 上传后的文件名
 * @returns Coze API 原始响应
 */
export async function executeMeetingAnalysis(
  meetingName: string,
  txtUrl?: string,
  fileId?: string,
  fileName?: string
) {
  return defaultWorkflowService.executeWorkflow({
    meetingName,
    txtUrl,
    fileId,
    fileName,
  });
}

/**
 * 便捷函数：上传文件到 Coze
 * @param filePath - 文件路径
 * @returns 上传后的文件信息
 */
export async function uploadFileToCoze(filePath: string) {
  return defaultFileService.uploadFile(filePath);
}

/**
 * 便捷函数：查询工作流执行结果
 * @param workflowId - 工作流 ID
 * @param executeId - 执行 ID
 * @returns 工作流运行历史详情
 */
export async function getWorkflowResult(workflowId: string, executeId: string) {
  return defaultWorkflowService.getWorkflowHistory(workflowId, executeId);
}

/**
 * 便捷函数：执行会议分析并等待完成
 * @param meetingName - 会议名称
 * @param txtUrl - 文本文件 URL
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
    signal?: AbortSignal;
  }
) {
  const executeResult = await executeMeetingAnalysis(
    meetingName,
    txtUrl,
    fileId,
    fileName
  );
  
  const config = createConfigFromGlobal();
  
  return defaultPollingService.waitForCompletion(
    config.workflowId,
    executeResult.execute_id,
    options
  );
}
