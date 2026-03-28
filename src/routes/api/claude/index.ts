import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { taskManager } from '../../../services/claude/task-manager';
import { executeTask, subscribe, unsubscribeAll, resumeTask } from '../../../services/claude/claude-service';
import { upload, getUploadedFilePaths } from '../../../services/claude/file-handler';
import { getTask, getEventsByTaskId } from '../../../services/claude/db';

console.log('[Claude Module] >>> index.ts loaded at', new Date().toISOString());
const router = Router();

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

// ---- GET /skills — 读取本机已安装的 skill 列表 ----
router.get('/skills', (_req: Request, res: Response) => {
  try {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skills = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const skillMdPath = path.join(SKILLS_DIR, e.name, 'SKILL.md');
        let description = '';
        try {
          // 取 SKILL.md 的 description frontmatter 字段作为说明
          const raw = fs.readFileSync(skillMdPath, 'utf-8');
          const match = raw.match(/^description:\s*["']?(.+?)["']?\s*$/m);
          if (match) description = match[1].trim();
        } catch { /* 没有 SKILL.md 就留空 */ }
        return { value: e.name, label: e.name };
      });
    res.json({ skills });
  } catch {
    res.json({ skills: [] });
  }
});

// ---- 公共参数校验 ----

function validateCreateParams(body: any, uploadedFiles?: Express.Multer.File[]): { error: string } | null {
  if (!body.name || typeof body.name !== 'string') return { error: '缺少必填参数: name（任务名称）' };
  if (!body.prompt || typeof body.prompt !== 'string') return { error: '缺少必填参数: prompt' };
  if (!body.workDir || typeof body.workDir !== 'string') return { error: '缺少必填参数: workDir' };
  try {
    fs.mkdirSync(body.workDir, { recursive: true });
  } catch (e: any) {
    return { error: `工作目录无法创建: ${body.workDir}（${e.message}）` };
  }
  // 文件二选一必传：上传文件 或 服务器文件路径
  const hasUpload = uploadedFiles && uploadedFiles.length > 0;
  const hasFilePaths = Array.isArray(body.filePaths) ? body.filePaths.length > 0 : !!body.filePaths;
  if (!hasUpload && !hasFilePaths) return { error: '缺少文件：请上传文件（files）或提供服务器文件路径（filePaths）' };
  return null;
}function setSseHeaders(res: Response, taskId: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Task-Id': taskId,
  });
}

/**
 * POST / - 启动任务并立即以 SSE 流式响应（原有行为不变，前端页面使用）
 *
 * Multipart body:
 *   prompt   string   (必填)
 *   workDir  string   (必填)
 *   skill?   string
 *   filePaths? string[]
 *   model?   string
 *   files?   上传文件
 */
router.post('/', upload.array('files', 10), (req: Request, res: Response) => {
  const validErr = validateCreateParams(req.body || {}, req.files as Express.Multer.File[]);
  if (validErr) { res.status(400).json(validErr); return; }

  const { prompt, workDir, skill, filePaths, model } = req.body;
  const uploadedFiles = getUploadedFilePaths(req.files as Express.Multer.File[]);
  const allFiles = [
    ...uploadedFiles,
    ...(Array.isArray(filePaths) ? filePaths : filePaths ? [filePaths] : []),
  ];

  const task = taskManager.create({
    name: req.body.name, prompt, skill, workDir, model,
    uploadedFiles: allFiles.length > 0 ? allFiles : undefined,
  });

  setSseHeaders(res, task.id);

  // 订阅广播，然后执行任务
  subscribe(task.id, res);

  executeTask(task).catch((err) => {
    console.error(`[Claude Task ${task.id}] Unexpected error:`, err);
  });
});

/**
 * POST /async - 异步提交任务，立即返回元信息（外部系统使用）
 *
 * JSON body:
 *   prompt      string   (必填)
 *   workDir     string   (必填)
 *   skill?      string
 *   model?      string
 *   pipelineId? string   外部流水线 ID
 *   callbackUrl? string  任务完成后回调地址，POST workDir/result.json 内容
 */
router.post('/async', (req: Request, res: Response) => {
  const validErr = validateCreateParams(req.body || {}, []);
  if (validErr) { res.status(400).json(validErr); return; }

  const { name, prompt, workDir, skill, model, pipelineId, callbackUrl, filePaths } = req.body;
  const allFiles = Array.isArray(filePaths) ? filePaths : filePaths ? [filePaths] : [];

  const task = taskManager.create({
    name, prompt, skill, workDir, model, pipelineId, callbackUrl,
    uploadedFiles: allFiles.length > 0 ? allFiles : undefined,
  });

  // 立即响应，连接断开
  res.json({
    taskId: task.id,
    pipelineId: task.pipelineId ?? null,
    sessionId: task.sessionId ?? null,   // 任务刚建立时为 null，完成后可通过 status 接口获取
    status: task.status,
    startTime: task.startTime,
    streamUrl: `/saler-plugins/api/claude/${task.id}/stream`,
  });

  // 异步执行，不等待
  executeTask(task).catch((err) => {
    console.error(`[Claude Task ${task.id}] Unexpected error:`, err);
  });
});

/**
 * GET /:taskId/stream - 订阅任意任务的 SSE 流（支持历史回放）
 *
 * - 若任务仍在运行：先回放历史事件，再实时推送新事件
 * - 若任务已完成：回放历史后推 done 并关闭
 */
router.get('/:taskId/stream', (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const row = getTask(taskId);

  if (!row) {
    res.status(404).json({ error: '任务不存在', taskId });
    return;
  }

  setSseHeaders(res, taskId);

  // 回放历史：先推合并后的文本，再推关键事件
  if (row.resultText) {
    const textPayload = JSON.stringify({ type: 'text', content: row.resultText });
    res.write(`event: text\ndata: ${textPayload}\n\n`);
  }

  const events = getEventsByTaskId(taskId);
  for (const evt of events) {
    res.write(`event: ${evt.eventType}\ndata: ${evt.data}\n\n`);
  }

  // 任务已结束，直接关闭
  if (row.status === 'completed' || row.status === 'cancelled' || row.status === 'error') {
    const donePayload = JSON.stringify({ taskId, status: row.status, endTime: row.endTime });
    res.write(`event: done\ndata: ${donePayload}\n\n`);
    res.end();
    return;
  }

  // 任务仍在运行，订阅后续广播
  subscribe(taskId, res);
});

/**
 * DELETE /:taskId - 删除任务（含 DB 记录、events、内存缓存、SSE 订阅）
 * 运行中的任务会先被取消再删除
 */
router.delete('/:taskId', (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const task = taskManager.getSummary(taskId);

  if (!task) {
    res.status(404).json({ error: '任务不存在', taskId });
    return;
  }

  // 断开所有 SSE 订阅者
  unsubscribeAll(taskId);

  // 删除任务（含取消运行中任务 + 清 DB + 清内存 abortController）
  taskManager.delete(taskId);

  res.json({ success: true, taskId, deletedStatus: task.status });
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
 * POST /:taskId/resume - 续接已中断/报错任务（使用 Claude Code SDK resume）
 */
router.post('/:taskId/resume', async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const task = taskManager.get(taskId);

  if (!task) {
    res.status(404).json({ error: '任务不存在', taskId });
    return;
  }
  if (!task.sessionId) {
    res.status(400).json({ error: '该任务没有保存 sessionId，无法续接（任务可能从未成功运行过或版本较旧）', taskId });
    return;
  }
  if (task.status === 'running' || task.status === 'pending') {
    res.status(400).json({ error: `任务仍在运行中 (${task.status})，无需续接`, taskId });
    return;
  }

  try {
    const resumed = await resumeTask(task);
    res.json({ success: true, taskId, status: resumed.status, streamUrl: `/saler-plugins/api/claude/${taskId}/stream` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '续接失败', taskId });
  }
});

/**
 * POST /:taskId/retry - 用相同参数重新创建任务（无 sessionId 时使用）
 */
router.post('/:taskId/retry', (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const original = taskManager.get(taskId);

  if (!original) {
    res.status(404).json({ error: '任务不存在', taskId });
    return;
  }
  if (original.status === 'running' || original.status === 'pending') {
    res.status(400).json({ error: `原任务仍在运行中 (${original.status})，无需重试` });
    return;
  }

  const task = taskManager.create({
    name:          original.name,
    prompt:        original.prompt,
    skill:         original.skill,
    workDir:       original.workDir,
    model:         original.model,
    pipelineId:    original.pipelineId,
    callbackUrl:   original.callbackUrl,
    uploadedFiles: original.uploadedFiles,
  });

  executeTask(task).catch(() => {});
  res.json({ success: true, newTaskId: task.id, status: task.status, streamUrl: `/saler-plugins/api/claude/${task.id}/stream` });
});


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
