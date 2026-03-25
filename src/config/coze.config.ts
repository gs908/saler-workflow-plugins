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
      },
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
