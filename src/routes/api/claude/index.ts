import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import { taskManager } from '../../../services/claude/task-manager';
import { executeTask } from '../../../services/claude/claude-service';
import { upload, getUploadedFilePaths } from '../../../services/claude/file-handler';

console.log('[Claude Module] >>> index.ts loaded at', new Date().toISOString());
const router = Router();

/**
 * POST / - 启动 Claude Code 任务（SSE 流式响应）
 *
 * JSON body:
 *   prompt: string      (必填) 任务描述
 *   workDir: string     (必填) Claude 工作目录
 *   skill?: string      (可选) 指定使用的 skill 名称
 *   filePaths?: string[] (可选) 服务器上的文件路径
 *   model?: string      (可选) 模型选择
 *   maxTurns?: number   (可选) 最大轮次
 *
 * Multipart:
 *   同上 + files 字段携带上传文件
 */
router.post('/', upload.array('files', 10), (req: Request, res: Response) => {
  const { prompt, workDir, skill, filePaths, model } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: '缺少必填参数: prompt' });
    return;
  }
  if (!workDir || typeof workDir !== 'string') {
    res.status(400).json({ error: '缺少必填参数: workDir' });
    return;
  }

  if (!fs.existsSync(workDir)) {
    res.status(400).json({ error: `工作目录不存在: ${workDir}` });
    return;
  }

  const uploadedFiles = getUploadedFilePaths(req.files as Express.Multer.File[]);
  const allFiles = [
    ...uploadedFiles,
    ...(Array.isArray(filePaths) ? filePaths : filePaths ? [filePaths] : []),
  ];

  const task = taskManager.create({
    prompt,
    skill,
    workDir,
    model,
    uploadedFiles: allFiles.length > 0 ? allFiles : undefined,
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Task-Id': task.id,
  });

  res.on('close', () => {
    console.log(`[Claude Route] res.close fired! taskId=${task.id} status=${task.status}`);
    if (task.status === 'running') {
      console.log(`[Claude Route] Cancelling task due to client disconnect`);
      taskManager.cancel(task.id);
    }
  });

  executeTask(task, res).catch((err) => {
    console.error(`[Claude Task ${task.id}] Unexpected error:`, err);
    if (!res.writableEnded) {
      res.end();
    }
  });
});

/**
 * POST /:taskId/cancel - 取消任务
 */
router.post('/:taskId/cancel', (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const success = taskManager.cancel(taskId);

  if (!success) {
    const task = taskManager.get(taskId);
    if (!task) {
      res.status(404).json({ error: '任务不存在', taskId });
      return;
    }
    res.status(400).json({
      error: `无法取消状态为 "${task.status}" 的任务`,
      taskId,
      status: task.status,
    });
    return;
  }

  res.json({ success: true, taskId, status: 'cancelled' });
});

/**
 * GET /:taskId/status - 查询任务状态
 */
router.get('/:taskId/status', (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const summary = taskManager.getSummary(taskId);

  if (!summary) {
    res.status(404).json({ error: '任务不存在', taskId });
    return;
  }

  res.json(summary);
});

/**
 * GET / - 列出所有任务
 */
router.get('/', (_req: Request, res: Response) => {
  const tasks = taskManager.list();
  res.json({ total: tasks.length, tasks });
});

export default router;
