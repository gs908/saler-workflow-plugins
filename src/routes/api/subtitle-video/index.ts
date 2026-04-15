import { Router }  from 'express';
import fs           from 'node:fs';
import http         from 'node:http';
import https        from 'node:https';
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
 * 统一走后端代理返回，支持浏览器直接下载（local 和 MinIO 模式均适用）
 */
router.get('/:jobId/video', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job?.video_path) {
    res.status(404).json({ error: 'Video not ready' });
    return;
  }

  const filename = `${job.name || job.id}.mp4`;
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Type', 'video/mp4');

  // MinIO 模式：video_path 是 HTTP URL，代理返回
  if (job.video_path.startsWith('http')) {
    const client = job.video_path.startsWith('https') ? https : http;
    client.get(job.video_path, (upstream) => {
      if (upstream.headers['content-length']) {
        res.setHeader('Content-Length', upstream.headers['content-length']);
      }
      upstream.pipe(res);
    }).on('error', () => {
      if (!res.headersSent) res.status(502).json({ error: 'Failed to fetch video from storage' });
      else res.destroy();
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

export default router;
