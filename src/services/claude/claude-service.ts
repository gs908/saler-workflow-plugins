import { query } from '@anthropic-ai/claude-agent-sdk';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { taskManager, TaskInfo } from './task-manager';

const DEFAULT_ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep',
  'MultiEdit', 'TodoRead', 'TodoWrite',
];

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

function loadSkillContent(skillName: string): string | null {
  const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  try {
    return fs.readFileSync(skillPath, 'utf-8');
  } catch {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.toLowerCase().includes(skillName.toLowerCase())) {
        const altPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
        try {
          return fs.readFileSync(altPath, 'utf-8');
        } catch {
          continue;
        }
      }
    }
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

function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function executeTask(task: TaskInfo, res: Response): Promise<void> {
  taskManager.updateStatus(task.id, 'running');
  console.log(`[Claude Task ${task.id}] >>> START prompt="${task.prompt}" cwd="${task.workDir}" skill="${task.skill || 'none'}"`);

  writeSseEvent(res, 'init', {
    taskId: task.id,
    status: 'running',
    prompt: task.prompt,
    skill: task.skill,
    workDir: task.workDir,
  });

  try {
    console.log(`[Claude Task ${task.id}] >>> Calling SDK query()...`);
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
      },
    });

    console.log(`[Claude Task ${task.id}] >>> Entering for-await loop...`);
    let messageCount = 0;
    for await (const message of q) {
      messageCount++;
      console.log(`[Claude Task ${task.id}] >>> Message #${messageCount} type=${message.type} aborted=${task.abortController.signal.aborted}`);

      if (task.abortController.signal.aborted) {
        console.log(`[Claude Task ${task.id}] >>> Aborted during loop!`);
        break;
      }

      const event = mapMessageToSseEvent(message);
      if (event) {
        writeSseEvent(res, event.event, event.data);
      }
    }

    console.log(`[Claude Task ${task.id}] >>> Loop ended. messageCount=${messageCount} aborted=${task.abortController.signal.aborted}`);

    if (task.abortController.signal.aborted) {
      taskManager.updateStatus(task.id, 'cancelled');
      writeSseEvent(res, 'status', { type: 'status', status: 'cancelled', taskId: task.id });
    } else {
      taskManager.updateStatus(task.id, 'completed');
      writeSseEvent(res, 'status', { type: 'status', status: 'completed', taskId: task.id });
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : '';
    console.error(`[Claude Task ${task.id}] >>> CATCH Error:`, errorMsg);
    console.error(`[Claude Task ${task.id}] >>> Stack:`, errorStack);
    console.error(`[Claude Task ${task.id}] >>> aborted=${task.abortController.signal.aborted}`);

    taskManager.updateStatus(task.id, 'error', errorMsg);
    writeSseEvent(res, 'error', { type: 'error', error: errorMsg, taskId: task.id });
  } finally {
    writeSseEvent(res, 'done', {
      taskId: task.id,
      status: taskManager.get(task.id)?.status,
      endTime: Date.now(),
    });
    res.end();
  }
}

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
    if (block.type === 'text') {
      return {
        event: 'text',
        data: { type: 'text', content: block.text },
      };
    }
    if (block.type === 'tool_use') {
      return {
        event: 'tool_use',
        data: {
          type: 'tool_use',
          toolId: block.id,
          name: block.name,
          input: block.input,
        },
      };
    }
    if (block.type === 'tool_result') {
      return {
        event: 'tool_result',
        data: {
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          content: block.content,
        },
      };
    }
  }

  return null;
}

function handleStreamEvent(message: any): SseEvent | null {
  const evt = message.event;
  if (!evt) return null;

  if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
    return {
      event: 'text_delta',
      data: { type: 'text_delta', text: evt.delta.text },
    };
  }

  if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
    return {
      event: 'tool_start',
      data: {
        type: 'tool_start',
        toolId: evt.content_block.id,
        name: evt.content_block.name,
      },
    };
  }

  return null;
}
