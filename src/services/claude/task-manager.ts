import { v4 as uuidv4 } from 'uuid';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'error';

export interface TaskInfo {
  id: string;
  status: TaskStatus;
  prompt: string;
  skill?: string;
  workDir: string;
  model?: string;
  startTime: number;
  endTime?: number;
  error?: string;
  abortController: AbortController;
  uploadedFiles?: string[];
}

export type TaskSummary = Omit<TaskInfo, 'abortController'>;

class TaskManager {
  private tasks = new Map<string, TaskInfo>();

  private static readonly MAX_HISTORY = 100;

  create(params: {
    prompt: string;
    skill?: string;
    workDir: string;
    model?: string;
    uploadedFiles?: string[];
  }): TaskInfo {
    this.cleanup();

    const task: TaskInfo = {
      id: uuidv4(),
      status: 'pending',
      prompt: params.prompt,
      skill: params.skill,
      workDir: params.workDir,
      model: params.model,
      startTime: Date.now(),
      abortController: new AbortController(),
      uploadedFiles: params.uploadedFiles,
    };

    this.tasks.set(task.id, task);
    return task;
  }

  get(taskId: string): TaskInfo | undefined {
    return this.tasks.get(taskId);
  }

  updateStatus(taskId: string, status: TaskStatus, error?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = status;
    if (error) task.error = error;
    if (status === 'completed' || status === 'cancelled' || status === 'error') {
      task.endTime = Date.now();
    }
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== 'running' && task.status !== 'pending') return false;

    task.abortController.abort();
    this.updateStatus(taskId, 'cancelled');
    return true;
  }

  list(): TaskSummary[] {
    return Array.from(this.tasks.values())
      .map(({ abortController, ...rest }) => rest)
      .sort((a, b) => b.startTime - a.startTime);
  }

  getSummary(taskId: string): TaskSummary | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    const { abortController, ...rest } = task;
    return rest;
  }

  /**
   * 清理过多的历史任务，只保留最近 MAX_HISTORY 条已完成的任务
   */
  private cleanup(): void {
    if (this.tasks.size <= TaskManager.MAX_HISTORY) return;

    const finished = Array.from(this.tasks.entries())
      .filter(([, t]) => t.status === 'completed' || t.status === 'cancelled' || t.status === 'error')
      .sort((a, b) => a[1].startTime - b[1].startTime);

    const removeCount = this.tasks.size - TaskManager.MAX_HISTORY;
    for (let i = 0; i < Math.min(removeCount, finished.length); i++) {
      this.tasks.delete(finished[i][0]);
    }
  }
}

export const taskManager = new TaskManager();
