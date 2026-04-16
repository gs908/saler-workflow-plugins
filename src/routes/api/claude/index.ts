import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { taskManager } from '../../../services/claude/task-manager';
import { executeTask, subscribe, unsubscribeAll, resumeTask } from '../../../services/claude/claude-service';
import { resetTaskForRetry, resetTaskForTweak } from '../../../services/claude/db';
import { upload, getUploadedFilePaths } from '../../../services/claude/file-handler';
import { getTask, getEventsByTaskId } from '../../../services/claude/db';
import { proxyHttpVideo, buildContentDisposition } from '../../../utils/streaming-proxy';

console.log('[Claude Module] >>> index.ts loaded at', new Date().toISOString());
const router = Router();

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

// ---- GET /skills 动态读取已安装的 skill 列表 ----
router.get('/skills', (_req: Request, res: Response) => {
  try {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skills = entries
      .filter(e => e.isDirectory())
      .map(e => ({ value: e.name, label: e.name }));
    res.json({ skills });
  } catch {
    res.json({ skills: [] });
  }
});

// ---- 参数校验（前端 POST /，workDir 必填）----
function validateCreateParams(body: any): { error: string } | null {
  if (!body.name || typeof body.name !== 'string') return { error: '缺少必填参数: name（任务名称）' };
  if (!body.workDir || typeof body.workDir !== 'string') return { error: '缺少必填参数: workDir' };
  if (!body.pipelineId || typeof body.pipelineId !== 'string') return { error: '缺少必填参数: pipelineId / executeId（任务编号）' };
  return null;
}

// ---- 参数校验（外部 POST /async，workDir 可走默认值）----
function validateAsyncParams(body: any): { error: string } | null {
  if (!body.name || typeof body.name !== 'string') return { error: '缺少必填参数: name（任务名称）' };
  if (!body.pipelineId || typeof body.pipelineId !== 'string') return { error: '缺少必填参数: execute_id（任务编号）' };
  if (!body.filePaths || (!Array.isArray(body.filePaths) && typeof body.filePaths !== 'string')) {
    return { error: '缺少必填参数: filePaths（文件路径）' };
  }
  return null;
}

/** 生成 yyyyMMddHHmmss 格式时间戳，用于工作目录后缀 */
function makeTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function setSseHeaders(res: Response, taskId: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Task-Id': taskId,
  });
}

/**
 * POST / - 前端新建任务，SSE 实时流式返回执行过程
 */
router.post('/', upload.array('files', 10), (req: Request, res: Response) => {
  const validErr = validateCreateParams(req.body || {});
  if (validErr) { res.status(400).json(validErr); return; }

  const { prompt, workDir, skill, filePaths, model } = req.body;
  const pipelineId = req.body.pipelineId as string;
  const actualWorkDir = path.join(workDir, `${pipelineId}_${makeTimestamp()}`);
  fs.mkdirSync(actualWorkDir, { recursive: true });

  const uploadedFiles = getUploadedFilePaths(req.files as Express.Multer.File[]);
  const allFiles = [
    ...uploadedFiles,
    ...(Array.isArray(filePaths) ? filePaths : filePaths ? [filePaths] : []),
  ];

  const task = taskManager.create({
    name: req.body.name, prompt, skill, workDir: actualWorkDir, model, pipelineId,
    uploadedFiles: allFiles.length > 0 ? allFiles : undefined,
  });

  setSseHeaders(res, task.id);
  subscribe(task.id, res);

  executeTask(task).catch((err) => {
    console.error(`[Claude Task ${task.id}] Unexpected error:`, err);
  });
});

/**
 * POST /async - 外部系统异步调用，立即返回任务元信息，后台执行并回调
 *
 * 字段映射：外部传 execute_id，内部使用 pipelineId
 * 环境变量默认值：
 *   CLAUDE_DEFAULT_WORK_DIR     - 默认工作目录（workDir 不传时使用）
 *   CLAUDE_DEFAULT_PROMPT       - 默认提示词（prompt 不传时使用）
 *   CLAUDE_DEFAULT_SKILL        - 默认 skill（skill 不传时使用）
 *   CLAUDE_DEFAULT_CALLBACK_URL - 默认回调地址（callbackUrl 不传时使用）
 */
router.post('/async', (req: Request, res: Response) => {
  // execute_id 是外部接口字段，映射为内部 pipelineId
  const body = { ...req.body };
  if (body.execute_id && !body.pipelineId) {
    body.pipelineId = body.execute_id;
  }

  const validErr = validateAsyncParams(body);
  if (validErr) { res.status(400).json(validErr); return; }

  const { name, prompt, workDir, skill, model, pipelineId, callbackUrl, filePaths } = body;

  // 未传时使用环境变量中的默认值
  const resolvedWorkDir     = (workDir     || process.env.CLAUDE_DEFAULT_WORK_DIR     || '').trim();
  const resolvedPrompt      = (prompt      || process.env.CLAUDE_DEFAULT_PROMPT       || '').trim();
  const resolvedSkill       = (skill       || process.env.CLAUDE_DEFAULT_SKILL        || undefined);
  const resolvedCallbackUrl = (callbackUrl || process.env.CLAUDE_DEFAULT_CALLBACK_URL || undefined);

  if (!resolvedWorkDir) {
    res.status(400).json({ error: '缺少必填参数: workDir（且未配置 CLAUDE_DEFAULT_WORK_DIR）' });
    return;
  }
  if (!resolvedPrompt) {
    res.status(400).json({ error: '缺少必填参数: prompt（且未配置 CLAUDE_DEFAULT_PROMPT）' });
    return;
  }

  const actualWorkDir = path.join(resolvedWorkDir, `${pipelineId}_${makeTimestamp()}`);
  fs.mkdirSync(actualWorkDir, { recursive: true });

  const allFiles = Array.isArray(filePaths) ? filePaths : filePaths ? [filePaths] : [];

  const task = taskManager.create({
    name,
    prompt:        resolvedPrompt,
    skill:         resolvedSkill,
    workDir:       actualWorkDir,
    model,
    pipelineId,
    callbackUrl:   resolvedCallbackUrl,
    uploadedFiles: allFiles.length > 0 ? allFiles : undefined,
  });

  res.json({
    taskId:     task.id,
    execute_id: task.pipelineId ?? null,
    sessionId:  task.sessionId ?? null,
    status:     task.status,
    startTime:  task.startTime,
    streamUrl:  `/saler-plugins/api/claude/${task.id}/stream`,
  });

  executeTask(task).catch((err) => {
    console.error(`[Claude Task ${task.id}] Unexpected error:`, err);
  });
});

/**
 * GET /:taskId/stream - 前端/外部订阅 SSE 实时推送（支持历史回放）
 */
router.get('/:taskId/stream', (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const row = getTask(taskId);

  if (!row) {
    res.status(404).json({ error: '任务不存在', taskId });
    return;
  }

  setSseHeaders(res, taskId);

  if (row.resultText) {
    const textPayload = JSON.stringify({ type: 'text', content: row.resultText });
    res.write(`event: text\ndata: ${textPayload}\n\n`);
  }

  const events = getEventsByTaskId(taskId);
  for (const evt of events) {
    res.write(`event: ${evt.eventType}\ndata: ${evt.data}\n\n`);
  }

  if (row.status === 'completed' || row.status === 'cancelled' || row.status === 'error') {
    const donePayload = JSON.stringify({ taskId, status: row.status, endTime: row.endTime });
    res.write(`event: done\ndata: ${donePayload}\n\n`);
    res.end();
    return;
  }

  subscribe(taskId, res);
});

/**
 * DELETE /:taskId - 删除任务
 */
router.delete('/:taskId', async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const task = taskManager.getSummary(taskId);

  if (!task) {
    res.status(404).json({ error: '任务不存在', taskId });
    return;
  }

  unsubscribeAll(taskId);
  await taskManager.delete(taskId);

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
      error: `任务当前状态 "${task.status}" 无法取消`,
      taskId,
      status: task.status,
    });
    return;
  }

  res.json({ success: true, taskId, status: 'cancelled' });
});

/**
 * POST /:taskId/resume - 续接已取消/报错的任务（需有 sessionId）
 */
router.post('/:taskId/resume', async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const task = taskManager.get(taskId);

  if (!task) {
    res.status(404).json({ error: '任务不存在', taskId });
    return;
  }
  if (!task.sessionId) {
    res.status(400).json({ error: '该任务没有 sessionId，无法续接', taskId });
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
 * POST /:taskId/retry - 用原始参数重新创建并执行（无 sessionId 时使用）
 */
/**
 * POST /:taskId/retry - 原地重跑
 * body: { prompt?: string, mode: 'fresh' | 'tweak' }
 *   fresh - 清空工作区 + 清 sessionId，全新开始
 *   tweak - 保留工作区 + 保留 sessionId，基于上次结果微调
 */
router.post('/:taskId/retry', (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const original = taskManager.get(taskId);

  if (!original) {
    res.status(404).json({ error: '任务不存在', taskId });
    return;
  }
  if (original.status === 'running' || original.status === 'pending') {
    res.status(400).json({ error: `任务正在运行中 (${original.status})，请先取消再重跑` });
    return;
  }

  const newPrompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim()
    ? req.body.prompt.trim()
    : undefined;
  const mode = req.body?.mode === 'tweak' ? 'tweak' : 'fresh';

  if (mode === 'fresh') {
    // 清空工作区
    if (original.workDir && fs.existsSync(original.workDir)) {
      fs.rmSync(original.workDir, { recursive: true, force: true });
    }
    fs.mkdirSync(original.workDir, { recursive: true });
    resetTaskForRetry(taskId, newPrompt);
  } else {
    // 保留工作区，只重置状态
    resetTaskForTweak(taskId, newPrompt);
  }

  // 替换 AbortController，读取最新 DB 数据
  const ac = taskManager.resetForResume(taskId);
  const task = taskManager.get(taskId)!;
  const resumeSessionId = mode === 'tweak' ? (task.sessionId ?? undefined) : undefined;

  executeTask({ ...task, abortController: ac, status: 'pending' }, resumeSessionId).catch(() => {});

  res.json({ success: true, taskId, streamUrl: `/saler-plugins/api/claude/${taskId}/stream` });
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
 * GET /:taskId/video - 流式返回原始视频文件
 */
router.get('/:taskId/video', (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const task = taskManager.getSummary(taskId);
  if (!task?.videoPath) {
    res.status(404).json({ error: '视频文件不存在' });
    return;
  }

  // MinIO 模式：videoPath 是 HTTP URL，代理返回
  if (task.videoPath.startsWith('http')) {
    const filename = `${task.name || taskId}.mp4`;
    proxyHttpVideo(task.videoPath, res, {
      filename,
    });
    return;
  }

  // local 模式：本地文件流式返回（去掉 existsSync TOCTOU 检查）
  const stat = fs.statSync(task.videoPath);
  const disposition = buildContentDisposition(task.name, taskId);
  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
      'Content-Disposition': disposition,
    });
    fs.createReadStream(task.videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': disposition,
    });
    fs.createReadStream(task.videoPath).pipe(res);
  }
});

/**
 * GET / - 任务列表
 */
router.get('/', (_req: Request, res: Response) => {
  const tasks = taskManager.list();
  res.json({ total: tasks.length, tasks });
});

export default router;