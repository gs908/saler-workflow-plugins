import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import {
  TaskStatus,
  TaskRow,
  insertTask,
  updateTask,
  resetTaskForResume,
  getTask,
  listTasks,
  deleteTask as deleteTaskFromDb,
} from './db';
import { cleanupFiles } from './file-handler';

export type { TaskStatus };

export interface TaskInfo {
  id: string;
  name: string;
  status: TaskStatus;
  prompt: string;
  skill?: string;
  workDir: string;
  model?: string;
  startTime: number;
  endTime?: number;
  error?: string;
  uploadedFiles?: string[];
  pipelineId?: string;
  callbackUrl?: string;
  resultText?: string;
  sessionId?: string;  // Claude Code 会话 ID，用于续接执行
  videoPath?: string;
  playlistUrl?: string;
  source?: string;
  abortController: AbortController;
}

export type TaskSummary = Omit<TaskInfo, 'abortController'>;

// 只在内存里保存 abortController（轻量），其余数据走 DB
const abortControllers = new Map<string, AbortController>();

function rowToInfo(row: TaskRow): TaskInfo {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    prompt: row.prompt,
    skill: row.skill ?? undefined,
    workDir: row.workDir,
    model: row.model ?? undefined,
    startTime: row.startTime,
    endTime: row.endTime ?? undefined,
    error: row.error ?? undefined,
    uploadedFiles: row.uploadedFiles ? JSON.parse(row.uploadedFiles) : undefined,
    pipelineId: row.pipelineId ?? undefined,
    callbackUrl: row.callbackUrl ?? undefined,
    resultText: row.resultText ?? undefined,
    sessionId:   row.sessionId   ?? undefined,
    videoPath:   row.videoPath   ?? undefined,
    playlistUrl: row.playlistUrl ?? undefined,
    source:      row.source      ?? undefined,
    abortController: abortControllers.get(row.id) ?? new AbortController(),
  };
}

class TaskManager {
  create(params: {
    name: string;
    prompt: string;
    skill?: string;
    workDir: string;
    model?: string;
    uploadedFiles?: string[];
    pipelineId?: string;
    callbackUrl?: string;
    source?: string;
  }): TaskInfo {
    const id = uuidv4();
    const ac = new AbortController();
    abortControllers.set(id, ac);

    const row: TaskRow = {
      id,
      name: params.name,
      status: 'pending',
      prompt: params.prompt,
      skill: params.skill ?? null,
      workDir: params.workDir,
      model: params.model ?? null,
      startTime: Date.now(),
      endTime: null,
      error: null,
      uploadedFiles: params.uploadedFiles ? JSON.stringify(params.uploadedFiles) : null,
      pipelineId: params.pipelineId ?? null,
      callbackUrl: params.callbackUrl ?? null,
      resultText:  null,
      sessionId:   null,
      videoPath:   null,
      playlistUrl: null,
      source:      params.source ?? 'frontend',
    };

    insertTask(row);
    return rowToInfo(row);
  }

  get(taskId: string): TaskInfo | undefined {
    const row = getTask(taskId);
    if (!row) return undefined;
    // 如果 abortController 不在内存（重启后的旧任务），建一个占位
    if (!abortControllers.has(taskId)) {
      abortControllers.set(taskId, new AbortController());
    }
    return rowToInfo(row);
  }

  updateStatus(taskId: string, status: TaskStatus, error?: string): void {
    const fields: Parameters<typeof updateTask>[1] = { status };
    if (error) fields.error = error;
    if (status === 'completed' || status === 'cancelled' || status === 'error') {
      fields.endTime = Date.now();
    }
    updateTask(taskId, fields);

    // 更新内存中 task 对象的 status（给 res.on('close') 判断用）
    // 通过 abortControllers 无法直接更新，调用方需通过 get() 重新读取
  }

  updateResultText(taskId: string, resultText: string): void {
    updateTask(taskId, { resultText });
  }

  updateSessionId(taskId: string, sessionId: string): void {
    updateTask(taskId, { sessionId });
  }

  /** 续接任务时替换 AbortController 并重置状态（清除 endTime/error） */
  resetForResume(taskId: string): AbortController {
    const ac = new AbortController();
    abortControllers.set(taskId, ac);
    resetTaskForResume(taskId);
    return ac;
  }

  cancel(taskId: string): boolean {
    const row = getTask(taskId);
    if (!row) return false;
    if (row.status !== 'running' && row.status !== 'pending') return false;

    abortControllers.get(taskId)?.abort();
    this.updateStatus(taskId, 'cancelled');
    return true;
  }

  async delete(taskId: string): Promise<boolean> {
    const row = getTask(taskId);
    if (!row) return false;

    // 运行中的任务先取消
    if (row.status === 'running' || row.status === 'pending') {
      abortControllers.get(taskId)?.abort();
    }

    // 清理内存
    abortControllers.delete(taskId);

    // 清理 DB（tasks + task_events）
    deleteTaskFromDb(taskId);

    // 清理 workDir（去掉 existsSync TOCTOU 检查）
    if (row.workDir) {
      try {
        await fs.promises.rm(row.workDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[TaskManager] Failed to delete workDir ${row.workDir}:`, err);
      }
    }

    // 清理上传文件（临时目录）
    if (row.uploadedFiles) {
      try {
        cleanupFiles(JSON.parse(row.uploadedFiles));
      } catch (err) {
        console.warn(`[TaskManager] Failed to cleanup uploaded files:`, err);
      }
    }

    return true;
  }

  list(): TaskSummary[] {
    return listTasks().map((row) => {
      const { abortController, ...rest } = rowToInfo(row);
      return rest;
    });
  }

  getSummary(taskId: string): TaskSummary | undefined {
    const task = this.get(taskId);
    if (!task) return undefined;
    const { abortController, ...rest } = task;
    return rest;
  }

  cleanupAbortControllers(): void {
    // 定期清理已完成任务的 abortController，释放内存
    for (const [id, _] of abortControllers) {
      const row = getTask(id);
      if (!row || row.status === 'completed' || row.status === 'cancelled' || row.status === 'error') {
        abortControllers.delete(id);
      }
    }
  }
}

export const taskManager = new TaskManager();
