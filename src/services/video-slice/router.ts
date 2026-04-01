import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config';
import { enqueue } from './worker';
import type { CreateJobRequest, Job } from './types';

const router = Router();

// POST /slice/jobs — 接收切片任务（供外部调用，内部直接调 enqueue 即可）
router.post('/jobs', (req, res) => {
  if (config.ingestSecret) {
    const provided = req.headers['x-slice-ingest-secret'] ?? '';
    if (provided !== config.ingestSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const body = req.body as Partial<CreateJobRequest>;
  if (!body.source || !body.callbackUrl) {
    res.status(400).json({ error: 'source and callbackUrl are required' });
    return;
  }

  const job: Job = {
    id:             uuidv4(),
    status:         'pending',
    createdAt:      Date.now(),
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
  res.status(202).json({ jobId: job.id });
});

router.get('/health', (_req, res) => res.json({ status: 'ok' }));

export default router;
