import { WorkflowService } from './workflow-service';
import { createConfigFromGlobal } from './coze-client';
import { CozeServiceError, CozeWorkflowError } from './errors';
import { WorkflowRunHistory, PollingOptions, Logger } from './types';

/**
 * 轮询服务
 * 负责轮询等待工作流执行完成
 */
export class PollingService extends WorkflowService {
  constructor(config = createConfigFromGlobal(), logger?: Logger) {
    super(config, logger);
  }

  /**
   * 检查是否为终止状态
   */
  private isTerminalStatus(status: string): boolean {
    return ['success', 'completed', 'failed'].includes(status);
  }

  /**
   * 延迟等待，支持取消信号
   */
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      // 检查是否已取消
      if (signal?.aborted) {
        reject(new CozeServiceError('轮询已取消'));
        return;
      }

      const timeout = setTimeout(resolve, ms);

      // 监听取消信号
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new CozeServiceError('轮询已取消'));
      }, { once: true });
    });
  }

  /**
   * 轮询等待工作流执行完成
   * @param workflowId - 工作流 ID
   * @param executeId - 执行 ID
   * @param options - 轮询配置选项
   * @returns 最终执行结果
   */
  async waitForCompletion(
    workflowId: string,
    executeId: string,
    options: PollingOptions = {}
  ): Promise<WorkflowRunHistory> {
    const { maxAttempts = 30, interval = 2000, signal, initialDelay = 0 } = options;

    this.logger.info(
      `[PollingService] 开始轮询工作流执行状态: maxAttempts=${maxAttempts}, executeId=${executeId}, initialDelay=${initialDelay}ms`
    );

    // 首次延迟（如果配置了）
    if (initialDelay > 0) {
      this.logger.info(`[PollingService] 首次轮询延迟 ${initialDelay}ms...`);
      await this.delay(initialDelay, signal);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // 查询工作流状态
        const result = await this.getWorkflowHistory(workflowId, executeId);

        // 如果状态已完成或失败，直接返回
        if (this.isTerminalStatus(result.status)) {
          this.logger.info(
            `[PollingService] 工作流执行${result.status}, 共轮询 ${attempt} 次`
          );
          return result;
        }

        this.logger.debug(
          `[PollingService] 第 ${attempt} 次轮询, 状态: ${result.status}, 等待 ${interval}ms...`
        );

        // 等待后继续轮询（支持取消）
        await this.delay(interval, signal);
      } catch (error) {
        // 检查是否已取消
        if (error instanceof CozeServiceError && error.message === '轮询已取消') {
          throw error;
        }
        
        this.logger.error(`[PollingService] 第 ${attempt} 次轮询失败:`, error);
        
        // 如果是最后一次，抛出错误
        if (attempt === maxAttempts) {
          throw new CozeWorkflowError(
            `轮询失败（第 ${attempt} 次）: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error : undefined,
            workflowId,
            executeId
          );
        }
        
        // 否则等待后继续
        await this.delay(interval, signal);
      }
    }

    throw new CozeWorkflowError(
      `工作流执行超时，已轮询 ${maxAttempts} 次`,
      undefined,
      workflowId,
      executeId
    );
  }

  /**
   * 轮询并带回调通知
   * @param workflowId - 工作流 ID
   * @param executeId - 执行 ID
   * @param onProgress - 进度回调
   * @param options - 轮询配置选项
   */
  async waitForCompletionWithCallback(
    workflowId: string,
    executeId: string,
    onProgress: (result: WorkflowRunHistory, attempt: number) => void,
    options: PollingOptions = {}
  ): Promise<WorkflowRunHistory> {
    const { maxAttempts = 30, interval = 2000, signal } = options;

    this.logger.info(
      `[PollingService] 开始轮询（带回调）: maxAttempts=${maxAttempts}, executeId=${executeId}`
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.getWorkflowHistory(workflowId, executeId);

        // 通知进度
        onProgress(result, attempt);

        // 如果状态已完成或失败，直接返回
        if (this.isTerminalStatus(result.status)) {
          this.logger.info(
            `[PollingService] 工作流执行${result.status}, 共轮询 ${attempt} 次`
          );
          return result;
        }

        await this.delay(interval, signal);
      } catch (error) {
        if (error instanceof CozeServiceError && error.message === '轮询已取消') {
          throw error;
        }
        
        this.logger.error(`[PollingService] 第 ${attempt} 次轮询失败:`, error);
        
        if (attempt === maxAttempts) {
          throw new CozeWorkflowError(
            `轮询失败（第 ${attempt} 次）: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error : undefined,
            workflowId,
            executeId
          );
        }
        
        await this.delay(interval, signal);
      }
    }

    throw new CozeWorkflowError(
      `工作流执行超时，已轮询 ${maxAttempts} 次`,
      undefined,
      workflowId,
      executeId
    );
  }
}
