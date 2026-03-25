import { Router, Request, Response } from 'express';
import {
  executeMeetingAnalysis,
  getWorkflowResult,
  executeMeetingAnalysisAndWait,
  WorkflowExecuteResponse,
  WorkflowRunHistory,
} from '../../task/meeting-analysis';

const router = Router();

/**
 * 执行会议分析工作流
 * POST /api/coze/meeting-analysis
 *
 * Request Body:
 * {
 *   "meetingName": "会议名称",
 *   "txtUrl": "https://...txt",
 *   "waitForCompletion": false  // 可选，是否等待执行完成
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "code": 0,
 *     "msg": "",
 *     "execute_id": "741364789030728****",
 *     "debug_url": "https://www.coze.cn/work_flow?execute_id=...",
 *     "detail": { "logid": "20241210152726467C48D89D6DB2****" }
 *   }
 * }
 */
router.post('/meeting-analysis', async (req: Request, res: Response) => {
  try {
    const { meetingName, txtUrl, waitForCompletion = false } = req.body;

    // 参数校验
    if (!meetingName || typeof meetingName !== 'string') {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: meetingName',
      });
    }

    if (!txtUrl || typeof txtUrl !== 'string') {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: txtUrl',
      });
    }

    console.log(`[API] 执行会议分析: ${meetingName}, 等待完成: ${waitForCompletion}`);

    // 如果不需要等待，直接返回 Coze API 响应
    if (!waitForCompletion) {
      const result: WorkflowExecuteResponse = await executeMeetingAnalysis(meetingName, txtUrl);
      return res.json({
        success: true,
        data: result,
      });
    }

    // 执行并等待完成
    const result: WorkflowRunHistory = await executeMeetingAnalysisAndWait(meetingName, txtUrl, {
      maxAttempts: 30,
      interval: 2000,
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[API] 执行会议分析失败:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '执行工作流失败',
    });
  }
});

/**
 * 查询工作流执行结果
 * GET /api/coze/workflow-result/:workflowId/:executeId
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "executeId": "xxx",
 *     "workflowId": "xxx",
 *     "status": "success",
 *     "output": { ... },
 *     "error": null
 *   }
 * }
 */
router.get('/workflow-result/:workflowId/:executeId', async (req: Request, res: Response) => {
  try {
    const { workflowId, executeId } = req.params;

    // 参数校验
    if (!workflowId || !executeId) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: workflowId 或 executeId',
      });
    }

    // 确保参数为字符串（防止 TypeScript 类型错误）
    const wfId = String(workflowId);
    const execId = String(executeId);

    console.log(`[API] 查询工作流结果: workflowId=${wfId}, executeId=${execId}`);

    const result = await getWorkflowResult(wfId, execId);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[API] 查询工作流结果失败:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '查询执行结果失败',
    });
  }
});

/**
 * 查询会议分析执行结果（便捷接口，使用默认 workflowId）
 * GET /api/coze/meeting-result/:executeId
 */
router.get('/meeting-result/:executeId', async (req: Request, res: Response) => {
  try {
    const { executeId } = req.params;
    const { workflowId } = req.query;

    if (!executeId) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: executeId',
      });
    }

    // 确保参数为字符串（防止 TypeScript 类型错误）
    const execId = String(executeId);

    // 如果提供了 workflowId 则使用，否则从配置读取
    const wfId = (workflowId as string) || process.env.COZE_MEETING_WORKFLOW_ID || '';

    if (!wfId) {
      return res.status(400).json({
        success: false,
        error: '缺少 workflowId 参数，且环境变量未配置',
      });
    }

    console.log(`[API] 查询会议分析结果: executeId=${execId}`);

    const result = await getWorkflowResult(wfId, execId);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[API] 查询会议分析结果失败:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '查询执行结果失败',
    });
  }
});

/**
 * 健康检查
 * GET /api/coze/health
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Coze API 服务正常运行',
    timestamp: new Date().toISOString(),
  });
});

export default router;
