import { Router }  from 'express';
import fs           from 'node:fs';
import os           from 'node:os';
import path         from 'node:path';
import multer       from 'multer';
import { enqueue, getJob } from '../../../services/subtitle-video/worker';
import { listJobs }        from '../../../services/subtitle-video/db';

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
 */
router.get('/:jobId/video', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.video_path) {
    res.status(404).json({ error: 'Video not ready' });
    return;
  }

  // MinIO 模式：video_path 是 HTTP URL，直接重定向
  if (job.video_path.startsWith('http')) {
    res.redirect(job.video_path);
    return;
  }

  if (!fs.existsSync(job.video_path)) {
    res.status(404).json({ error: 'Video file not found on disk' });
    return;
  }

  const stat  = fs.statSync(job.video_path);
  const range = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': end - start + 1,
      'Content-Type':   'video/mp4',
    });
    fs.createReadStream(job.video_path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type':   'video/mp4',
    });
    fs.createReadStream(job.video_path).pipe(res);
  }
});

export default router;
