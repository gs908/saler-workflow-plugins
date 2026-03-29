/**
 * Coze 服务错误类 - 保留原始错误上下文
 */
export class CozeServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CozeServiceError';
    // 保留原始堆栈
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * 配置错误
 */
export class CozeConfigError extends CozeServiceError {
  constructor(message: string) {
    super(message);
    this.name = 'CozeConfigError';
  }
}

/**
 * 文件上传错误
 */
export class CozeFileUploadError extends CozeServiceError {
  constructor(
    message: string,
    cause?: Error,
    public readonly filePath?: string
  ) {
    super(message, cause);
    this.name = 'CozeFileUploadError';
  }
}

/**
 * 工作流执行错误
 */
export class CozeWorkflowError extends CozeServiceError {
  constructor(
    message: string,
    cause?: Error,
    public readonly workflowId?: string,
    public readonly executeId?: string
  ) {
    super(message, cause);
    this.name = 'CozeWorkflowError';
  }
}
