/**
 * SQLite 持久化层
 *
 * DB 路径优先读取环境变量 CLAUDE_DB_PATH，默认为项目根目录下的 data/claude-tasks.db
 * 可通过 .env 或启动命令配置到其他磁盘目录，例如：
 *   CLAUDE_DB_PATH=D:/data/claude-tasks.db
 */
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'error';

export interface TaskRow {
  id: string;
  name: string;
  status: TaskStatus;
  prompt: string;
  skill: string | null;
  workDir: string;
  model: string | null;
  startTime: number;
  endTime: number | null;
  error: string | null;
  uploadedFiles: string | null; // JSON array string
  pipelineId: string | null;
  callbackUrl: string | null;
  resultText: string | null;
  sessionId: string | null;
  videoPath: string | null;
  playlistUrl: string | null;
  source: string | null;
}

export interface EventRow {
  id: number;
  taskId: string;
  eventType: string;
  data: string; // JSON string
  createdAt: number;
}

function resolveDbPath(): string {
  const dbPath = process.env.CLAUDE_DB_PATH
    || path.join(__dirname, '..', '..', '..', 'data', 'claude-tasks.db');

  // 无论默认路径还是自定义路径，都确保目录存在
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dbPath;
}

const dbPath = resolveDbPath();
console.log(`[DB] SQLite path: ${dbPath}`);

const db = new Database(dbPath);

// WAL 模式提升并发读写性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending',
    prompt      TEXT    NOT NULL,
    skill       TEXT,
    workDir     TEXT    NOT NULL,
    model       TEXT,
    startTime   INTEGER NOT NULL,
    endTime     INTEGER,
    error       TEXT,
    uploadedFiles TEXT,
    pipelineId  TEXT,
    callbackUrl TEXT,
    resultText  TEXT,
    sessionId   TEXT
  );

  CREATE TABLE IF NOT EXISTS task_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    taskId      TEXT    NOT NULL,
    eventType   TEXT    NOT NULL,
    data        TEXT    NOT NULL,
    createdAt   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_task_events_taskId ON task_events(taskId);
  CREATE INDEX IF NOT EXISTS idx_tasks_startTime ON tasks(startTime DESC);
`);

// 兼容旧库：如果 sessionId 列不存在则加上
try {
  db.exec('ALTER TABLE tasks ADD COLUMN sessionId TEXT');
} catch { /* 列已存在，忽略 */ }
// 兼容旧库：如果 name 列不存在则加上
try {
  db.exec("ALTER TABLE tasks ADD COLUMN name TEXT NOT NULL DEFAULT ''");
} catch { /* 列已存在，忽略 */ }
try {
  db.exec('ALTER TABLE tasks ADD COLUMN videoPath TEXT');
} catch { /* 列已存在，忽略 */ }
try {
  db.exec('ALTER TABLE tasks ADD COLUMN playlistUrl TEXT');
} catch { /* 列已存在，忽略 */ }
try {
  db.exec("ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'frontend'");
} catch { /* 列已存在，忽略 */ }

// 启动时将残留 running 状态的任务标为 error（服务重启导致任务中断）
const staleCount = db.prepare(
  `UPDATE tasks SET status='error', error='服务重启，任务中断', endTime=? WHERE status='running' OR status='pending'`
).run(Date.now()).changes;
if (staleCount > 0) {
  console.log(`[DB] Marked ${staleCount} stale task(s) as error on startup`);
}

// ---- Task CRUD ----

const stmtInsertTask = db.prepare<TaskRow>(`
  INSERT INTO tasks (id, name, status, prompt, skill, workDir, model, startTime, endTime, error, uploadedFiles, pipelineId, callbackUrl, resultText, sessionId, source)
  VALUES (@id, @name, @status, @prompt, @skill, @workDir, @model, @startTime, @endTime, @error, @uploadedFiles, @pipelineId, @callbackUrl, @resultText, @sessionId, @source)
`);

export function insertTask(task: TaskRow): void {
  stmtInsertTask.run(task);
}

const stmtUpdateTask = db.prepare<Partial<TaskRow> & { id: string }>(`
  UPDATE tasks SET
    status      = COALESCE(@status, status),
    endTime     = COALESCE(@endTime, endTime),
    error       = COALESCE(@error, error),
    resultText  = COALESCE(@resultText, resultText),
    sessionId   = COALESCE(@sessionId, sessionId),
    videoPath   = COALESCE(@videoPath, videoPath),
    playlistUrl = COALESCE(@playlistUrl, playlistUrl)
  WHERE id = @id
`);

export function updateTask(id: string, fields: Partial<Pick<TaskRow, 'status' | 'endTime' | 'error' | 'resultText' | 'sessionId' | 'videoPath' | 'playlistUrl'>>): void {
  stmtUpdateTask.run({
    id,
    status:      fields.status      ?? null,
    endTime:     fields.endTime     ?? null,
    error:       fields.error       ?? null,
    resultText:  fields.resultText  ?? null,
    sessionId:   fields.sessionId   ?? null,
    videoPath:   fields.videoPath   ?? null,
    playlistUrl: fields.playlistUrl ?? null,
  } as any);
}

/** 续接任务专用：强制清空 endTime / error，状态设为 running */
const stmtResetForResume = db.prepare<{ id: string }>(`
  UPDATE tasks SET status = 'running', endTime = NULL, error = NULL WHERE id = @id
`);

export function resetTaskForResume(id: string): void {
  stmtResetForResume.run({ id });
}

/** 重跑：clearSession=1 清空 sessionId（全新开始），=0 保留（微调） */
const stmtReset = db.prepare<{ id: string; prompt: string | null; clearSession: 0 | 1 }>(`
  UPDATE tasks SET
    status      = 'pending',
    endTime     = NULL,
    error       = NULL,
    resultText  = NULL,
    sessionId   = CASE WHEN @clearSession THEN NULL ELSE sessionId END,
    videoPath   = NULL,
    playlistUrl = NULL,
    prompt      = COALESCE(@prompt, prompt)
  WHERE id = @id
`);

export function resetTaskForRetry(id: string, newPrompt?: string): void {
  stmtReset.run({ id, prompt: newPrompt ?? null, clearSession: 1 });
}

export function resetTaskForTweak(id: string, newPrompt?: string): void {
  stmtReset.run({ id, prompt: newPrompt ?? null, clearSession: 0 });
}

const stmtGetTask = db.prepare<{ id: string }>('SELECT * FROM tasks WHERE id = @id');

export function getTask(id: string): TaskRow | undefined {
  return stmtGetTask.get({ id }) as TaskRow | undefined;
}

const stmtListTasks = db.prepare('SELECT * FROM tasks ORDER BY startTime DESC LIMIT 200');

export function listTasks(): TaskRow[] {
  return stmtListTasks.all() as TaskRow[];
}

const stmtDeleteTask = db.prepare<{ id: string }>('DELETE FROM tasks WHERE id = @id');
const stmtDeleteEvents = db.prepare<{ taskId: string }>('DELETE FROM task_events WHERE taskId = @taskId');

// 事务删除：同时清理 tasks 和 task_events
const deleteTaskTx = db.transaction((id: string) => {
  stmtDeleteEvents.run({ taskId: id });
  stmtDeleteTask.run({ id });
});

export function deleteTask(id: string): void {
  deleteTaskTx(id);
}

// ---- Event CRUD ----

const stmtInsertEvent = db.prepare<Omit<EventRow, 'id'>>(`
  INSERT INTO task_events (taskId, eventType, data, createdAt)
  VALUES (@taskId, @eventType, @data, @createdAt)
`);

export function insertEvent(taskId: string, eventType: string, data: unknown): void {
  stmtInsertEvent.run({ taskId, eventType, data: JSON.stringify(data), createdAt: Date.now() });
}

const stmtGetEvents = db.prepare<{ taskId: string }>('SELECT * FROM task_events WHERE taskId = @taskId ORDER BY id ASC');

export function getEventsByTaskId(taskId: string): EventRow[] {
  return stmtGetEvents.all({ taskId }) as EventRow[];
}

export default db;
