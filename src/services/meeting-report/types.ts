/**
 * Coze 服务相关类型定义
 */

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
 * 文件上传结果
 */
export interface FileUploadResult {
  id: string;
  file_name: string;
  bytes: number;
  created_at: number;
}

/**
 * 轮询选项
 */
export interface PollingOptions {
  /** 最大轮询次数，默认 30 */
  maxAttempts?: number;
  /** 轮询间隔（毫秒），默认 2000 */
  interval?: number;
  /** 取消信号，用于中断轮询 */
  signal?: AbortSignal;
  /** 首次轮询延迟（毫秒），默认 0 */
  initialDelay?: number;
}

/**
 * Coze 客户端配置
 * 支持依赖注入，解耦全局配置
 */
export interface CozeClientConfig {
  /** API Token */
  token: string;
  /** API 基础 URL */
  baseURL: string;
  /** 会议分析工作流 ID */
  workflowId: string;
  /** 是否异步执行 */
  isAsync: boolean;
}

/**
 * 日志接口抽象
 * 允许替换为不同的日志实现
 */
export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

/**
 * 默认控制台日志实现
 */
export class ConsoleLogger implements Logger {
  debug(message: string, ...args: unknown[]): void {
    console.log(`[DEBUG] ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    console.log(`[INFO] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }
}

/**
 * Debug 包日志实现
 */
export class DebugLogger implements Logger {
  private debugLog: debug.Debugger;
  private infoLog: debug.Debugger;
  private warnLog: debug.Debugger;
  private errorLog: debug.Debugger;

  constructor(namespace: string = 'coze:service') {
    // 动态导入 debug 包
    const debug = require('debug');
    this.debugLog = debug(`${namespace}:debug`);
    this.infoLog = debug(`${namespace}:info`);
    this.warnLog = debug(`${namespace}:warn`);
    this.errorLog = debug(`${namespace}:error`);
  }

  debug(message: string, ...args: unknown[]): void {
    this.debugLog(message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.infoLog(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.warnLog(message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.errorLog(message, ...args);
  }
}
