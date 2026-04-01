import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { config } from './config';
import { uploadDir, buildMinioUrl } from './minio-client';
import type { Job } from './types';

const queue: Job[] = [];
let running = false;

export function enqueue(job: Job): void {
  queue.push(job);
  if (!running) processNext();
}

async function processNext(): Promise<void> {
  const job = queue.shift();
  if (!job) { running = false; return; }

  running = true;
  job.status = 'running';
  console.log(`[Slice Worker] job=${job.id} source=${job.source}`);

  const outputDir = path.join(config.hlsOutputDir, job.id);
  fs.mkdirSync(outputDir, { recursive: true });
  const m3u8Path = path.join(outputDir, 'index.m3u8');

  try {
    await runFfmpeg(job.source, m3u8Path);

    if (config.storageType === 'minio') {
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const prefix = job.name
        ? `${date}/${job.name}/${job.id}`
        : `${date}/${job.id}`;
      await uploadDir(outputDir, prefix);
      job.playlistUrl = buildMinioUrl(`${prefix}/index.m3u8`);
      fs.rmSync(outputDir, { recursive: true, force: true });
      console.log(`[Slice Worker] job=${job.id} uploaded to MinIO, local temp removed`);
    } else {
      job.playlistUrl = buildPlaylistUrl(job.id);
    }

    job.status = 'done';
    console.log(`[Slice Worker] job=${job.id} done playlist=${job.playlistUrl}`);
    await postCallback(job);
  } catch (err) {
    job.status = 'fail';
    job.error = err instanceof Error ? err.message : String(err);
    console.error(`[Slice Worker] job=${job.id} failed: ${job.error}`);
    await postCallback(job);
  } finally {
    processNext();
  }
}

function runFfmpeg(source: string, m3u8Path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', source,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-hls_time', '30',
      '-hls_list_size', '0',
      '-hls_segment_filename', path.join(path.dirname(m3u8Path), 'segment%03d.ts'),
      '-f', 'hls',
      m3u8Path,
    ];
    const proc = spawn(config.ffmpegPath, args);
    proc.stderr.on('data', (d) => process.stdout.write(`[ffmpeg] ${d}`));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

function buildPlaylistUrl(jobId: string): string {
  return `${config.hlsPublicBaseUrl}${config.hlsUrlPathPrefix}/${jobId}/index.m3u8`;
}

async function postCallback(job: Job): Promise<void> {
  const body: Record<string, unknown> = {
    type:       job.type ?? 'video_create',
    taskId:     job.taskId ?? null,
    execute_id: job.execute_id ?? null,
    outcome:    'success', // 视频本身成功，切片失败属于降级，不影响整体结果
  };

  body.path = job.source;
  if (job.videoUrl) body.video_url = job.videoUrl;
  if (job.status === 'done') body.playlist_url = job.playlistUrl;
  if (job.status === 'fail') body.slice_error = job.error; // 降级：告知切片失败原因，但 outcome 仍为 success

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (job.callbackSecret) headers['X-Presales-Video-Callback-Secret'] = job.callbackSecret;

  try {
    await axios.post(job.callbackUrl, body, {
      headers,
      timeout: config.downstreamCallbackTimeoutMs,
    });
    console.log(`[Slice Worker] job=${job.id} callback sent outcome=${body.outcome}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Slice Worker] job=${job.id} callback failed: ${msg}`);
  }
}
