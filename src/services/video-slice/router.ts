import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config';
import { enqueue, buildJobUrls } from './worker';
import type { CreateJobRequest, Job } from './types';

const router = Router();

// POST /slice/jobs — 接收切片任务
// 内部调用（带 callbackUrl）：切片完成后回调下游
// 对外调用（不带 callbackUrl）：立即返回预计算好的 playlistUrl / coverUrl，后台异步切片
router.post('/jobs', (req, res) => {
  if (config.ingestSecret) {
    const provided = req.headers['x-slice-ingest-secret'] ?? '';
    if (provided !== config.ingestSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const body = req.body as Partial<CreateJobRequest>;
  if (!body.source) {
    res.status(400).json({ error: 'source is required' });
    return;
  }

  const jobId = uuidv4();
  const hlsDate = new Date().toISOString().slice(0, 10);
  const job: Job = {
    id:             jobId,
    status:         'pending',
    createdAt:      Date.now(),
    hlsDate,
    source:         body.source,
    callbackUrl:    body.callbackUrl,
    execute_id:     body.execute_id,
    taskId:         body.taskId,
    name:           body.name,
    type:           body.type ?? 'video_create',
    callbackSecret: body.callbackSecret,
    videoUrl:       body.videoUrl,
  };

  enqueue(job);
  console.log(`[Slice] Accepted job=${job.id} source=${job.source}`);

  if (!body.callbackUrl) {
    const { playlistUrl, coverUrl } = buildJobUrls(jobId, hlsDate, body.name);
    res.status(202).json({ jobId, execute_id: body.execute_id ?? null, playlistUrl, coverUrl });
    return;
  }

  res.status(202).json({ jobId: job.id });
});

router.get('/health', (_req, res) => res.json({ status: 'ok' }));

export default router;
