/**
 * Coze 工作流配置
 * 所有配置从 .env 文件读取
 */

// 从环境变量读取配置
const getConfig = () => {
  const token = process.env.COZE_API_TOKEN;
  const meetingWorkflowId = process.env.COZE_MEETING_WORKFLOW_ID;

  // 验证必需的配置
  if (!token) {
    console.warn('[CozeConfig] 警告: COZE_API_TOKEN 未设置，请在 .env 文件中配置');
  }
  if (!meetingWorkflowId) {
    console.warn('[CozeConfig] 警告: COZE_MEETING_WORKFLOW_ID 未设置，请在 .env 文件中配置');
  }

  return {
    // API 基础配置
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',

    // 认证 Token
    token: token || '',

    // 工作流配置
    workflows: {
      // 会议分析工作流
      meetingAnalysis: {
        workflowId: meetingWorkflowId || '',
        isAsync: true,
      },
    },

    // 轮询配置（首次延迟单位为分钟，间隔单位为秒，最大次数为次数）
    polling: {
      // 首次轮询延迟（分钟），默认 5 分钟
      initialDelay: (process.env.COZE_POLLING_INITIAL_DELAY
        ? parseInt(process.env.COZE_POLLING_INITIAL_DELAY, 10)
        : 5) * 60 * 1000,
      // 后续轮询间隔（秒），默认 30 秒
      interval: (process.env.COZE_POLLING_INTERVAL
        ? parseInt(process.env.COZE_POLLING_INTERVAL, 10)
        : 30) * 1000,
      // 最大轮询次数，默认 60 次
      maxAttempts: process.env.COZE_POLLING_MAX_ATTEMPTS
        ? parseInt(process.env.COZE_POLLING_MAX_ATTEMPTS, 10)
        : 60,
    },
  };
};

export const cozeConfig = getConfig();

/**
 * 检查 Coze 配置是否有效
 */
export function validateCozeConfig(): boolean {
  const isValid = !!(cozeConfig.token && cozeConfig.workflows.meetingAnalysis.workflowId);
  if (!isValid) {
    console.error('[CozeConfig] 配置无效，请检查 .env 文件中的 COZE_API_TOKEN 和 COZE_MEETING_WORKFLOW_ID');
  }
  return isValid;
}

/**
 * 轮询配置接口
 */
export interface CozePollingConfig {
  /** 首次轮询延迟（毫秒） */
  initialDelay: number;
  /** 后续轮询间隔（毫秒） */
  interval: number;
  /** 最大轮询次数 */
  maxAttempts: number;
}
