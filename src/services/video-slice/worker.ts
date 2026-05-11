import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { config } from './config';
import { uploadDir, buildMinioUrl } from './minio-client';
import { updateTask, insertCallbackLog } from '../claude/db';
import { safeRemoveDir } from '../../utils/fs-utils';
import type { Job } from './types';

const COVER_FILENAME = 'cover.jpg';

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

  const outputDir = path.join(config.hlsOutputDir, ...buildMinioPrefix(job.id, job.hlsDate, job.name).split('/'));
  fs.mkdirSync(outputDir, { recursive: true });
  const m3u8Path  = path.join(outputDir, 'index.m3u8');
  const coverPath = path.join(outputDir, COVER_FILENAME);

  let duration: number | undefined;
  try {
    await Promise.all([
      runFfmpeg(job.source, m3u8Path),
      extractCover(job.source, coverPath),
    ]);

    duration = await getDuration(job.source);

    if (config.storageType === 'minio') {
      const prefix = buildMinioPrefix(job.id, job.hlsDate, job.name);
      await uploadDir(outputDir, prefix);
      job.playlistUrl = buildMinioUrl(`${prefix}/index.m3u8`);
      job.videoUrl = buildMinioUrl(`${prefix}/origin.mp4`);
      await safeRemoveDir(outputDir);
      console.log(`[Slice Worker] job=${job.id} uploaded to MinIO, local temp removed`);
      // 更新 videoPath 和 playlistUrl 为 MinIO URL
      if (job.taskId) updateTask(job.taskId, { playlistUrl: job.playlistUrl, videoPath: job.videoUrl });
    } else {
      job.playlistUrl = buildPlaylistUrl(buildMinioPrefix(job.id, job.hlsDate, job.name));
      // 本地模式 videoPath 已经是正确的本地路径，无需更新
      if (job.taskId) updateTask(job.taskId, { playlistUrl: job.playlistUrl });
    }

    job.status = 'done';
    if (job.onDone) job.onDone(job.playlistUrl);
    console.log(`[Slice Worker] job=${job.id} done playlist=${job.playlistUrl}`);
    await postCallback(job, duration);
  } catch (err) {
    job.status = 'fail';
    job.error = err instanceof Error ? err.message : String(err);
    console.error(`[Slice Worker] job=${job.id} failed: ${job.error}`);
    // 失败时保留本地文件用于调试，不删除
    await postCallback(job);
  } finally {
    processNext();
  }
}

function execFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffmpegPath, ['-y', ...args]);
    proc.stderr.on('data', (d) => process.stdout.write(`[ffmpeg] ${d}`));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

function runFfmpeg(source: string, m3u8Path: string): Promise<void> {
  return execFfmpeg([
    '-i', source,
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-hls_time', String(config.hlsSegmentTime),
    '-hls_list_size', '0',
    '-hls_segment_filename', path.join(path.dirname(m3u8Path), 'segment%03d.ts'),
    '-f', 'hls',
    m3u8Path,
  ]);
}

function extractCover(source: string, coverPath: string): Promise<void> {
  return execFfmpeg([
    '-ss', '0',
    '-i', source,
    '-vframes', '1',
    '-q:v', '2',
    '-f', 'image2',
    coverPath,
  ]);
}

function buildPlaylistUrl(prefix: string): string {
  return `${config.hlsPublicBaseUrl}${config.hlsUrlPathPrefix}/${prefix}/index.m3u8`;
}

export function buildMinioPrefix(jobId: string, date: string, name?: string): string {
  return name ? `${date}/${name}/${jobId}` : `${date}/${jobId}`;
}

/** 预计算 job 完成后的播放地址和封面地址，需传入入队时固定的 hlsDate 以确保与实际上传路径一致 */
export function buildJobUrls(jobId: string, hlsDate: string, name?: string): { playlistUrl: string; coverUrl: string } {
  if (config.storageType === 'minio') {
    const prefix = buildMinioPrefix(jobId, hlsDate, name);
    return {
      playlistUrl: buildMinioUrl(`${prefix}/index.m3u8`),
      coverUrl:    buildMinioUrl(`${prefix}/${COVER_FILENAME}`),
    };
  }
  const prefix = buildMinioPrefix(jobId, hlsDate, name);
  const playlistUrl = buildPlaylistUrl(prefix);
  return {
    playlistUrl,
    coverUrl: playlistUrl.replace('index.m3u8', COVER_FILENAME),
  };
}

function getDuration(source: string): Promise<number | undefined> {
  const ffprobe = config.ffmpegPath.replace(/ffmpeg([^/\\]*)$/i, 'ffprobe$1');
  return new Promise((resolve) => {
    const proc = spawn(ffprobe, [
      '-v', 'quiet', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', source,
    ]);
    let out = '';
    proc.stdout.on('data', (d: Buffer) => (out += d));
    proc.on('close', (code) => {
      const n = code === 0 ? parseFloat(out.trim()) : NaN;
      resolve(isNaN(n) ? undefined : n);
    });
    proc.on('error', () => resolve(undefined));
  });
}

async function postCallback(job: Job, duration?: number): Promise<void> {
  // 无回调地址时只存库不回调
  if (!job.callbackUrl) {
    console.log(`[Slice Worker] job=${job.id} 无回调地址，跳过 POST`);
    return;
  }

  const body: Record<string, unknown> = {
    type:       job.type ?? 'video_create',
    taskId:     job.taskId ?? null,
    execute_id: job.execute_id ?? null,
    outcome:    'success', // 视频本身成功，切片失败属于降级，不影响整体结果
    ...(duration != null ? { duration: Math.round(duration * 10) / 10 } : {}),
  };

  // MinIO 模式：path 用 MinIO URL，本地模式：path 用本地路径
  body.path = config.storageType === 'minio' && job.videoUrl ? job.videoUrl : job.source;
  if (job.videoUrl) body.video_url = job.videoUrl;
  if (job.status === 'done') {
    body.playlist_url = job.playlistUrl;
    if (job.playlistUrl) {
      body.cover_url = job.playlistUrl.replace('index.m3u8', COVER_FILENAME);
    }
  }
  if (job.status === 'fail') body.slice_error = job.error; // 降级：告知切片失败原因，但 outcome 仍为 success

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (job.callbackSecret) headers['X-Presales-Video-Callback-Secret'] = job.callbackSecret;

  try {
    await axios.post(job.callbackUrl, body, {
      headers,
      timeout: config.downstreamCallbackTimeoutMs,
    });
    console.log(`[Slice Worker] job=${job.id} callback sent outcome=${body.outcome}`);
    insertCallbackLog({
      taskId: job.taskId ?? job.id, type: 'auto', status: 'success',
      callbackUrl: job.callbackUrl, requestBody: JSON.stringify(body),
      error: null, createdAt: Date.now(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Slice Worker] job=${job.id} callback failed: ${msg}`);
    insertCallbackLog({
      taskId: job.taskId ?? job.id, type: 'auto', status: 'fail',
      callbackUrl: job.callbackUrl, requestBody: JSON.stringify(body),
      error: msg, createdAt: Date.now(),
    });
  }
}
