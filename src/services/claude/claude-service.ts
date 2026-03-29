import { query } from '@anthropic-ai/claude-agent-sdk';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { taskManager, TaskInfo } from './task-manager';
import { insertEvent } from './db';

const DEFAULT_ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep',
  'MultiEdit', 'TodoRead', 'TodoWrite',
];

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

// ---- SSE 广播机制 ----
// taskId -> 订阅该任务的所有 SSE 响应对象
const subscribers = new Map<string, Set<Response>>();

export function subscribe(taskId: string, res: Response): void {
  if (!subscribers.has(taskId)) {
    subscribers.set(taskId, new Set());
  }
  subscribers.get(taskId)!.add(res);

  res.on('close', () => {
    subscribers.get(taskId)?.delete(res);
    if (subscribers.get(taskId)?.size === 0) {
      subscribers.delete(taskId);
    }
  });
}

function broadcast(taskId: string, event: string, data: unknown): void {
  const subs = subscribers.get(taskId);
  if (!subs || subs.size === 0) return;
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) {
    try {
      res.write(line);
    } catch {
      // 忽略已断开的连接
    }
  }
}

function broadcastEnd(taskId: string): void {
  const subs = subscribers.get(taskId);
  if (!subs) return;
  for (const res of subs) {
    try { res.end(); } catch { /* ignore */ }
  }
  subscribers.delete(taskId);
}

/** 强制断开并清理某个任务的所有订阅者（用于删除任务时） */
export function unsubscribeAll(taskId: string): void {
  broadcastEnd(taskId);
}

// ---- Skill 加载 ----

function loadSkillContent(skillName: string): string | null {
  const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    console.log(`[Skill] Loaded "${skillName}" from ${skillPath} (${content.length} chars)`);
    return content;
  } catch {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.toLowerCase().includes(skillName.toLowerCase())) {
        const altPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
        try {
          const content = fs.readFileSync(altPath, 'utf-8');
          console.log(`[Skill] Fuzzy matched "${skillName}" → "${entry.name}" (${content.length} chars)`);
          return content;
        } catch {
          continue;
        }
      }
    }
    console.warn(`[Skill] NOT FOUND: "${skillName}" in ${SKILLS_DIR}`);
    return null;
  }
}

function buildPrompt(task: TaskInfo): string {
  const parts: string[] = [];

  if (task.uploadedFiles && task.uploadedFiles.length > 0) {
    parts.push('以下是需要处理的文件路径：');
    for (const f of task.uploadedFiles) {
      parts.push(`- ${f}`);
    }
    parts.push('');
  }

  parts.push(task.prompt);
  return parts.join('\n');
}

function buildSystemPrompt(task: TaskInfo): { type: 'preset'; preset: 'claude_code'; append?: string } {
  const appendParts: string[] = [];

  if (task.skill) {
    const skillContent = loadSkillContent(task.skill);
    if (skillContent) {
      appendParts.push(`请严格按照以下 Skill 指令执行任务：\n\n${skillContent}`);
    } else {
      appendParts.push(`请使用 "${task.skill}" skill 来完成任务。如果找不到该 skill，请按你的最佳判断执行。`);
    }
  }

  appendParts.push('你正在通过 API 被调用，无需等待用户确认，请自主完成所有步骤。');

  return {
    type: 'preset',
    preset: 'claude_code',
    append: appendParts.join('\n\n'),
  };
}

// ---- 工具函数 ----

/** 需要持久化到 DB 的事件类型（跳过高频 text_delta） */
const PERSIST_EVENT_TYPES = new Set(['init', 'tool_use', 'tool_start', 'tool_result', 'status', 'error', 'done']);

function broadcastAndPersist(taskId: string, event: string, data: unknown): void {
  broadcast(taskId, event, data);
  if (PERSIST_EVENT_TYPES.has(event)) {
    insertEvent(taskId, event, data);
  }
}

/** 任务完成后读取 workDir/result.json 并 POST 给 callbackUrl */
async function triggerCallback(task: TaskInfo): Promise<void> {
  if (!task.callbackUrl) return;

  const resultPath = path.join(task.workDir, 'output', 'result.json');
  let resultData: any = {
    type:       'video_create',
    taskId:     task.id,
    execute_id: task.pipelineId ?? null,
    sessionId:  task.sessionId ?? null,
    outcome:    'fail',
  };

  // 尝试读取 result.json
  try {
    const raw = fs.readFileSync(resultPath, 'utf-8');
    const parsed = JSON.parse(raw);
    resultData = {
      ...resultData,
      ...parsed,
      path:       parsed.output_file,
      outcome:    parsed.status === 'success' ? 'success' : 'fail',
      hasResult:  true,
    };
    console.log(`[Claude Task ${task.id}] result.json 读取成功`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Claude Task ${task.id}] result.json 读取失败 (${msg})，将回调基本状态信息，outcome=fail`);
    resultData.hasResult = false;
    resultData.error = `result.json not found or invalid: ${msg}`;
  }

  try {
    await axios.post(task.callbackUrl, resultData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    console.log(`[Claude Task ${task.id}] Callback sent to ${task.callbackUrl}, outcome=${resultData.outcome}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Claude Task ${task.id}] Callback failed: ${msg}`);
  }
}

// ---- 核心执行函数 ----

/**
 * 执行 Claude Code 任务，通过广播机制推送 SSE 给所有订阅者。
 * 调用前请先用 subscribe(task.id, res) 注册订阅者。
 */
export async function executeTask(task: TaskInfo, resumeSessionId?: string): Promise<void> {
  taskManager.updateStatus(task.id, 'running');
  console.log(`[Claude Task ${task.id}] >>> START prompt="${task.prompt}" cwd="${task.workDir}" skill="${task.skill || 'none'}"${resumeSessionId ? ` resume=${resumeSessionId}` : ''}`);

  broadcastAndPersist(task.id, 'init', {
    taskId: task.id,
    status: 'running',
    prompt: task.prompt,
    skill: task.skill,
    workDir: task.workDir,
    pipelineId: task.pipelineId,
  });

  let accumulatedText = '';

  try {
    const q = query({
      prompt: buildPrompt(task),
      options: {
        cwd: task.workDir,
        abortController: task.abortController,
        allowedTools: DEFAULT_ALLOWED_TOOLS,
        model: task.model,
        settingSources: ['user', 'project'],
        systemPrompt: buildSystemPrompt(task),
        includePartialMessages: true,
        maxTurns: 50,
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      },
    });

    for await (const message of q) {
      if (task.abortController.signal.aborted) break;

      // 捕获 sessionId — 从任何含 session_id 的消息中提取，越早越好
      // （result 消息可能因异常而未到达，system/assistant 等消息更早携带它）
      const msgSessionId = (message as any).session_id;
      if (msgSessionId && !taskManager.get(task.id)?.sessionId) {
        taskManager.updateSessionId(task.id, msgSessionId);
      }

      const event = mapMessageToSseEvent(message);
      if (event) {
        // 累积文本（text_delta 实时流 + result 最终结果）
        if (event.event === 'text_delta' && typeof (event.data as any).text === 'string') {
          accumulatedText += (event.data as any).text;
        } else if (event.event === 'result' && typeof (event.data as any).result === 'string') {
          accumulatedText += '\n\n---\n\n' + (event.data as any).result;
        }

        broadcastAndPersist(task.id, event.event, event.data);
      }
    }

    const finalStatus = task.abortController.signal.aborted ? 'cancelled' : 'completed';
    taskManager.updateStatus(task.id, finalStatus);
    if (accumulatedText) {
      taskManager.updateResultText(task.id, accumulatedText);
    }

    broadcastAndPersist(task.id, 'status', { type: 'status', status: finalStatus, taskId: task.id });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Claude Task ${task.id}] >>> Error:`, errorMsg);

    taskManager.updateStatus(task.id, 'error', errorMsg);
    if (accumulatedText) taskManager.updateResultText(task.id, accumulatedText);

    broadcastAndPersist(task.id, 'error', { type: 'error', error: errorMsg, taskId: task.id });
  } finally {
    const latestTask = taskManager.get(task.id);
    broadcastAndPersist(task.id, 'done', {
      taskId: task.id,
      status: latestTask?.status,
      endTime: Date.now(),
    });
    broadcastEnd(task.id);

    // 触发外部回调（异步，不阻塞）
    if (latestTask?.callbackUrl) {
      triggerCallback(latestTask).catch(() => {});
    }
  }
}

// ---- 消息映射 ----

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function mapMessageToSseEvent(message: any): SseEvent | null {
  switch (message.type) {
    case 'assistant':
      return handleAssistantMessage(message);
    case 'result':
      return {
        event: 'result',
        data: {
          type: 'result',
          result: message.result,
          usage: message.usage,
          sessionId: message.session_id,
        },
      };
    case 'stream_event':
      return handleStreamEvent(message);
    default:
      return null;
  }
}

function handleAssistantMessage(message: any): SseEvent | null {
  if (!message.message?.content) return null;

  const contents = Array.isArray(message.message.content)
    ? message.message.content
    : [message.message.content];

  for (const block of contents) {
    // text 类型不再单独推送（text_delta 已实时推过），避免前端重复累加
    if (block.type === 'tool_use') {
      return {
        event: 'tool_use',
        data: { type: 'tool_use', toolId: block.id, name: block.name, input: block.input },
      };
    }
    if (block.type === 'tool_result') {
      return {
        event: 'tool_result',
        data: { type: 'tool_result', toolUseId: block.tool_use_id, content: block.content },
      };
    }
  }

  return null;
}

function handleStreamEvent(message: any): SseEvent | null {
  const evt = message.event;
  if (!evt) return null;

  if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
    return { event: 'text_delta', data: { type: 'text_delta', text: evt.delta.text } };
  }

  if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
    return {
      event: 'tool_start',
      data: { type: 'tool_start', toolId: evt.content_block.id, name: evt.content_block.name },
    };
  }

  return null;
}

/**
 * 续接执行：从已中断/报错任务的 sessionId 继续
 */
export async function resumeTask(originalTask: TaskInfo): Promise<TaskInfo> {
  if (!originalTask.sessionId) {
    throw new Error('该任务没有可用的 sessionId，无法续接');
  }
  if (originalTask.status === 'running' || originalTask.status === 'pending') {
    throw new Error('任务仍在运行中，无需续接');
  }

  const newAbortController = taskManager.resetForResume(originalTask.id);

  const resumedTask: TaskInfo = {
    ...originalTask,
    status: 'running',
    endTime: undefined,
    error: undefined,
    abortController: newAbortController,
  };

  executeTask(resumedTask, originalTask.sessionId).catch((err) => {
    console.error(`[Claude Task ${resumedTask.id}] Resume error:`, err);
  });
  return resumedTask;
}

