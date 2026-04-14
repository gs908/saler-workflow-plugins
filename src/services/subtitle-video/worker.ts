import { spawn }  from 'node:child_process';
import fs          from 'node:fs';
import path        from 'node:path';
import os          from 'node:os';
import axios       from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { insertJob, updateJob, getJob } from './db';
import { enqueue as sliceEnqueue, buildMinioPrefix } from '../video-slice/worker';
import { config as sliceConfig }                    from '../video-slice/config';
import { buildMinioUrl }                            from '../video-slice/minio-client';
import type { CreateSubtitleJobParams, SubtitleJobRow } from './types';

const PYTHON_PATH = process.env.SUBTITLE_VIDEO_PYTHON_PATH || 'python';
const FONT_PATH   = process.env.SUBTITLE_VIDEO_FONT_PATH   || '';
const SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'generate_video.py');

export { getJob };

export function enqueue(params: CreateSubtitleJobParams): string {
  const id  = uuidv4();
  const now = Date.now();

  const row: SubtitleJobRow = {
    id,
    name:         params.name         ?? null,
    execute_id:   params.execute_id   ?? null,
    status:       'pending',
    audio_path:   params.audio_path,
    txt_path:     params.txt_path,
    video_path:   null,
    playlist_url: null,
    callback_url: params.callback_url ?? null,
    progress:     null,
    error:        null,
    created_at:   now,
    updated_at:   now,
  };
  insertJob(row);

  processJob(row, params.name, params.videoConfig).catch((err) => {
    console.error(`[Subtitle Worker] job=${id} unhandled: ${err}`);
  });

  return id;
}

async function processJob(
  job: SubtitleJobRow,
  name?: string,
  videoConfig?: Record<string, unknown>,
): Promise<void> {
  updateJob(job.id, { status: 'processing' });

  const today       = new Date().toISOString().slice(0, 10);
  const minioPrefix = buildMinioPrefix(job.id, today, name);
  const videoDir    = path.join(sliceConfig.hlsOutputDir, ...minioPrefix.split('/'));
  const outputMp4   = path.join(videoDir, 'origin.mp4');
  const tmpDir    = path.join(os.tmpdir(), 'subtitle-video', job.id);
  const cfgPath   = path.join(tmpDir, 'config.json');
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(tmpDir,   { recursive: true });

  const cfg = {
    video:      { width: 1280, height: 720, fps: 30 },
    background: { type: 'color', colorFrom: '#f8faff', colorTo: '#eef4ff' },
    font:       { path: FONT_PATH, sizeCurrent: 42, sizeContext: 20, sizeSpeaker: 20 },
    layout:     { linesAbove: 2, linesBelow: 2, lineSpacing: 20 },
    colors: {
      current: '#2563eb',
      near:    'rgb(100, 116, 139)',
      far:     'rgb(148, 163, 184)',
      speaker: '#f59e0b',
    },
    ...(videoConfig ?? {}),
  };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');

  try {
    await spawnPython(job, outputMp4, cfgPath, name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateJob(job.id, { status: 'error', error: msg });
    fs.rmSync(tmpDir,    { recursive: true, force: true });
    fs.rmSync(videoDir,  { recursive: true, force: true });
    await postFailCallback(job, msg);
    return;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // origin.mp4 与 HLS 切片同目录，uploadDir/rmSync 会一并处理
  const videoUrl = sliceConfig.storageType === 'minio'
    ? buildMinioUrl(`${minioPrefix}/origin.mp4`)
    : outputMp4;

  updateJob(job.id, { status: 'completed', video_path: videoUrl });

  sliceEnqueue({
    id:          job.id,
    status:      'pending',
    createdAt:   Date.now(),
    hlsDate:     today,
    source:      outputMp4,
    callbackUrl: job.callback_url ?? undefined,
    execute_id:  job.execute_id   ?? undefined,
    taskId:      job.id,
    name,
    type:        'video_create',
    videoUrl,
    onDone:      (playlistUrl) => updateJob(job.id, { playlist_url: playlistUrl }),
  });

  console.log(`[Subtitle Worker] job=${job.id} MP4 ready, enqueued to slice pipeline`);
}

function spawnPython(job: SubtitleJobRow, outputMp4: string, cfgPath: string, title?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON_PATH, [
      SCRIPT_PATH,
      '--config', cfgPath,
      '--audio',  job.audio_path,
      '--txt',    job.txt_path,
      '--output', outputMp4,
      '--title',  title ?? '',
    ]);

    py.stdout.setEncoding('utf8');
    py.stdout.on('data', (data: string) => {
      const line = data.trim();
      if (!line) return;
      console.log(`[Subtitle Worker] ${line}`);
      if (line.startsWith('[进度]') || line.startsWith('[INFO]') || line.startsWith('[完成]')) {
        updateJob(job.id, { progress: line });
      }
    });

    py.stderr.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) console.error(`[Subtitle Worker:py] ${line}`);
    });

    py.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python exited with code ${code}`));
    });

    py.on('error', (err) => reject(new Error(`spawn failed: ${err.message}`)));
  });
}

async function postFailCallback(job: SubtitleJobRow, error: string): Promise<void> {
  const url = job.callback_url;
  if (!url) return;
  try {
    await axios.post(url, {
      type:       'video_create',
      taskId:     job.id,
      execute_id: job.execute_id ?? null,
      outcome:    'fail',
      error,
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
    console.log(`[Subtitle Worker] job=${job.id} fail callback sent`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Subtitle Worker] job=${job.id} fail callback failed: ${msg}`);
  }
}
