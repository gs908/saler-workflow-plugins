/**
 * subtitle_video_jobs 表
 * 共用 CLAUDE_DB_PATH 指向的同一个 SQLite 文件，但使用独立表，互不耦合
 */
import db from '../claude/db';
import type { SubtitleJobRow } from './types';

db.exec(`
  CREATE TABLE IF NOT EXISTS subtitle_video_jobs (
    id           TEXT    PRIMARY KEY,
    name         TEXT,
    execute_id   TEXT,
    status       TEXT    NOT NULL DEFAULT 'pending',
    audio_path   TEXT    NOT NULL,
    txt_path     TEXT    NOT NULL,
    video_path   TEXT,
    playlist_url TEXT,
    callback_url TEXT,
    progress     TEXT,
    error        TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_subtitle_jobs_created ON subtitle_video_jobs(created_at DESC);
`);

// 旧表迁移：补加 name 列（CREATE TABLE IF NOT EXISTS 不会重建，需单独 ALTER）
try { db.exec(`ALTER TABLE subtitle_video_jobs ADD COLUMN name TEXT`); } catch {}

const stmtInsert = db.prepare<SubtitleJobRow>(`
  INSERT INTO subtitle_video_jobs
    (id, name, execute_id, status, audio_path, txt_path, video_path, playlist_url, callback_url, progress, error, created_at, updated_at)
  VALUES
    (@id, @name, @execute_id, @status, @audio_path, @txt_path, @video_path, @playlist_url, @callback_url, @progress, @error, @created_at, @updated_at)
`);

const stmtUpdate = db.prepare<{ id: string; status: string | null; video_path: string | null; playlist_url: string | null; progress: string | null; error: string | null; updated_at: number }>(`
  UPDATE subtitle_video_jobs SET
    status       = COALESCE(@status,       status),
    video_path   = COALESCE(@video_path,   video_path),
    playlist_url = COALESCE(@playlist_url, playlist_url),
    progress     = COALESCE(@progress,     progress),
    error        = COALESCE(@error,        error),
    updated_at   = @updated_at
  WHERE id = @id
`);

const stmtGet = db.prepare<{ id: string }>('SELECT * FROM subtitle_video_jobs WHERE id = @id');

export function insertJob(job: SubtitleJobRow): void {
  stmtInsert.run(job);
}

export function updateJob(id: string, fields: Partial<Pick<SubtitleJobRow, 'status' | 'video_path' | 'playlist_url' | 'progress' | 'error'>>): void {
  stmtUpdate.run({
    id,
    status:       fields.status       ?? null,
    video_path:   fields.video_path   ?? null,
    playlist_url: fields.playlist_url ?? null,
    progress:     fields.progress     ?? null,
    error:        fields.error        ?? null,
    updated_at:   Date.now(),
  });
}

export function getJob(id: string): SubtitleJobRow | undefined {
  return stmtGet.get({ id }) as SubtitleJobRow | undefined;
}

const stmtList = db.prepare('SELECT * FROM subtitle_video_jobs ORDER BY created_at DESC LIMIT 50');

export function listJobs(): SubtitleJobRow[] {
  return stmtList.all() as SubtitleJobRow[];
}

const stmtDelete = db.prepare<{ id: string }>('DELETE FROM subtitle_video_jobs WHERE id = @id');

export function deleteJob(id: string): boolean {
  return stmtDelete.run({ id }).changes > 0;
}
