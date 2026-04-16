import { Router }  from 'express';
import fs           from 'node:fs';
import os           from 'node:os';
import path         from 'node:path';
import multer       from 'multer';
import axios        from 'axios';
import { enqueue, getJob } from '../../../services/subtitle-video/worker';
import { listJobs, deleteJob } from '../../../services/subtitle-video/db';
import { getCallbackLogsByTaskId, insertCallbackLog } from '../../../services/claude/db';
import { proxyHttpVideo } from '../../../utils/streaming-proxy';

const router = Router();

const resolveCallbackUrl = (url?: string) => url || process.env.CLAUDE_DEFAULT_CALLBACK_URL || undefined;

// multer：前端上传文件临时存储
const upload = multer({
  dest: path.join(os.tmpdir(), 'subtitle-video-uploads'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

/**
 * POST /saler-plugins/api/subtitle-video/async
 * 下游调用（JSON传服务器路径）
 */
router.post('/async', (req, res) => {
  const { execute_id, audio_path, txt_path, callback_url, name, config: videoConfig } = req.body ?? {};

  if (!audio_path || !txt_path) {
    res.status(400).json({ error: 'audio_path and txt_path are required' });
    return;
  }
  if (!fs.existsSync(audio_path)) {
    res.status(400).json({ error: `audio_path not found: ${audio_path}` });
    return;
  }
  if (!fs.existsSync(txt_path)) {
    res.status(400).json({ error: `txt_path not found: ${txt_path}` });
    return;
  }

  const resolvedCallbackUrl = resolveCallbackUrl(callback_url);
  const jobId = enqueue({ execute_id, audio_path, txt_path, callback_url: resolvedCallbackUrl, name, videoConfig });
  res.json({ jobId, execute_id: execute_id ?? null, status: 'pending' });
});

/**
 * POST /saler-plugins/api/subtitle-video/upload-and-async
 * 前端页面调用（multipart 上传文件）
 */
router.post('/upload-and-async', upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'txt',   maxCount: 1 },
]), (req, res) => {
  const files  = req.files as Record<string, Express.Multer.File[]>;
  const audio  = files?.['audio']?.[0];
  const txt    = files?.['txt']?.[0];
  const { execute_id, name, callback_url } = req.body ?? {};

  if (!audio || !txt) {
    res.status(400).json({ error: 'audio and txt files are required' });
    return;
  }

  const resolvedCallbackUrl = resolveCallbackUrl(callback_url);
  const jobId = enqueue({
    execute_id: execute_id || undefined,
    audio_path: audio.path,
    txt_path:   txt.path,
    callback_url: resolvedCallbackUrl,
    name:       name || undefined,
  });

  res.json({ jobId, execute_id: execute_id ?? null, status: 'pending' });
});

/**
 * GET /saler-plugins/api/subtitle-video/list
 */
router.get('/list', (_req, res) => {
  res.json(listJobs());
});

/**
 * DELETE /saler-plugins/api/subtitle-video/:jobId
 */
router.delete('/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  deleteJob(job.id);

  // 只清理前端上传到临时目录的缓存文件，上游传入的路径和结果文件均不删除
  const tmpUploadDir = path.join(os.tmpdir(), 'subtitle-video-uploads');
  [job.audio_path, job.txt_path].forEach(p => {
    if (p && p.startsWith(tmpUploadDir)) {
      try { fs.rmSync(p, { force: true }); }
      catch (err) { console.warn(`[SubtitleVideo] Failed to delete temp file ${p}:`, err); }
    }
  });

  res.json({ success: true, jobId: job.id });
});

/**
 * GET /saler-plugins/api/subtitle-video/:jobId/status
 */
router.get('/:jobId/status', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({
    jobId:        job.id,
    execute_id:   job.execute_id,
    status:       job.status,
    progress:     job.progress   ?? null,
    playlist_url: job.playlist_url ?? null,
    video_path:   job.video_path ?? null,
    error:        job.error      ?? null,
  });
});

/**
 * GET /saler-plugins/api/subtitle-video/:jobId/video
 * 统一走后端代理返回，支持浏览器直接下载（local 和 MinIO 模式均适用）
 */
router.get('/:jobId/video', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.video_path) {
    res.status(404).json({ error: 'Video not ready' });
    return;
  }

  // MinIO 模式：video_path 是 HTTP URL，代理返回
  if (job.video_path.startsWith('http')) {
    proxyHttpVideo(job.video_path, res, {
      filename: `${job.name || job.id}.mp4`,
    });
    return;
  }

  // local 模式：本地文件流式返回
  fs.createReadStream(job.video_path)
    .on('error', (err: NodeJS.ErrnoException) => {
      if (!res.headersSent) {
        res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Video file not found on disk' });
      }
    })
    .pipe(res);
});

/**
 * GET /saler-plugins/api/subtitle-video/:jobId/callback-logs
 * 查询回调推送历史
 */
router.get('/:jobId/callback-logs', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  const logs = getCallbackLogsByTaskId(job.id);
  res.json({ logs });
});

/**
 * POST /saler-plugins/api/subtitle-video/:jobId/callback
 * 手动推送回调
 */
router.post('/:jobId/callback', async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (!job.callback_url) {
    res.status(400).json({ error: '该任务没有回调地址' });
    return;
  }

  const isCompleted = job.status === 'completed';
  const body: Record<string, unknown> = {
    type:       'video_create',
    taskId:     job.id,
    execute_id: job.execute_id ?? null,
    outcome:    isCompleted ? 'success' : 'fail',
  };
  if (job.video_path)   body.video_url    = job.video_path;
  if (job.playlist_url) body.playlist_url = job.playlist_url;
  if (job.playlist_url) body.cover_url    = job.playlist_url.replace('index.m3u8', 'cover.jpg');
  if (!isCompleted && job.error) body.error = job.error;

  try {
    await axios.post(job.callback_url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    console.log(`[SubtitleVideo] job=${job.id} manual callback sent`);
    insertCallbackLog({
      taskId: job.id, type: 'manual', status: 'success',
      callbackUrl: job.callback_url, requestBody: JSON.stringify(body),
      error: null, createdAt: Date.now(),
    });
    res.json({ success: true, jobId: job.id });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SubtitleVideo] job=${job.id} manual callback failed: ${msg}`);
    insertCallbackLog({
      taskId: job.id, type: 'manual', status: 'fail',
      callbackUrl: job.callback_url, requestBody: JSON.stringify(body),
      error: msg, createdAt: Date.now(),
    });
    res.json({ success: false, jobId: job.id, error: msg });
  }
});

export default router;
