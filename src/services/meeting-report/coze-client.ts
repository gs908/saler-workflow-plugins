import { CozeAPI } from '@coze/api';
import { HttpClient } from '../../utils/http-client';
import { CozeConfigError } from './errors';
import { CozeClientConfig, Logger, DebugLogger } from './types';

/**
 * Coze 基础客户端
 * 支持配置注入，解耦全局配置依赖
 */
export class CozeBaseClient {
  /** Coze SDK 客户端 */
  protected apiClient: CozeAPI;
  /** HTTP 客户端（用于 REST API） */
  protected httpClient: HttpClient;
  /** 配置 */
  protected config: CozeClientConfig;
  /** 日志 */
  protected logger: Logger;

  constructor(config: CozeClientConfig, logger?: Logger) {
    this.validateConfig(config);
    this.config = config;
    this.logger = logger || new DebugLogger('coze:client');
    
    // 初始化 Coze SDK 客户端
    this.apiClient = new CozeAPI({
      token: config.token,
      baseURL: config.baseURL,
    });

    // 初始化 HTTP 客户端（用于查询运行历史等 REST API）
    this.httpClient = new HttpClient({
      baseURL: config.baseURL,
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

    this.logger.debug('[CozeBaseClient] 客户端初始化完成');
  }

  /**
   * 校验配置有效性
   */
  private validateConfig(config: CozeClientConfig): void {
    if (!config.token?.trim()) {
      throw new CozeConfigError('Coze API Token 不能为空');
    }

    if (!config.baseURL?.trim()) {
      throw new CozeConfigError('Coze API BaseURL 不能为空');
    }

    if (!config.workflowId?.trim()) {
      throw new CozeConfigError('工作流 ID 不能为空');
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<CozeClientConfig> {
    return { ...this.config };
  }

  /**
   * 获取日志实例
   */
  getLogger(): Logger {
    return this.logger;
  }
}

/**
 * 从全局配置创建客户端配置
 * 用于兼容现有代码
 */
export function createConfigFromGlobal(): CozeClientConfig {
  // 使用动态导入避免循环依赖
  const { cozeConfig } = require('../../config/coze.config');

  return {
    token: cozeConfig.token,
    baseURL: cozeConfig.baseURL,
    workflowId: cozeConfig.workflows.meetingAnalysis.workflowId,
    isAsync: cozeConfig.workflows.meetingAnalysis.isAsync,
    polling: cozeConfig.polling,
  };
}
