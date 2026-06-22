import type { LLMAdapter, LLMMessage } from '../adapter';
import type { SkillDefinition } from '../skill';
import { needsCompaction, compactMessages } from '../context/compactor';

export interface AgentLoopCallbacks {
  onProgress?: (message: string) => void;
  onToolCall?: (skillName: string, args: Record<string, unknown>) => void;
  onToolResult?: (skillName: string, result: string, isError: boolean) => void;
  onResponse?: (content: string, iteration: number) => void;
  onRequestInput?: (question: string) => Promise<string>;
  onCompaction?: (beforeTokens: number, afterTokens: number) => void;
}

export interface AgentLoopOptions {
  goal: string;
  adapter: LLMAdapter;
  skills?: SkillDefinition[];
  systemPrompt?: string;
  maxIterations?: number;
  timeoutMs?: number;
  callbacks?: AgentLoopCallbacks;
  abortSignal?: AbortSignal;
}

export interface AgentLoopResult {
  content: string;
  iterations: number;
  completed: boolean;
  summary?: string;
  durationMs: number;
  toolCallCount: number;
}

const DEFAULT_SYSTEM_PROMPT = `あなたは目標達成のために自律的に行動するエージェントです。与えられたツール（スキル）を活用してタスクを遂行してください。

ルール:
- ステップバイステップで目標に取り組むこと
- reportProgress で進捗をユーザーに報告すること
- ユーザーの追加情報が必要な場合は requestUserInput を使うこと
- 目標を達成したら、必ず markComplete を呼び出して達成内容のサマリーを報告すること
- 目標を達成するか、達成不可能と判断するまで作業を中断しないこと
- 達成できない場合は markComplete でその理由を説明すること`;

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    goal,
    adapter,
    skills = [],
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    maxIterations = 25,
    timeoutMs = 120_000,
    callbacks = {},
    abortSignal,
  } = options;

  const startMs = Date.now();
  let isComplete = false;
  let completeSummary: string | undefined;
  let toolCallCount = 0;
  let lastContent = '';

  // Build control skills
  const controlSkills: SkillDefinition[] = [
    {
      name: 'markComplete',
      description: 'Signal that the goal has been fully accomplished. Call this when the task is done or cannot be done.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'A summary of what was accomplished or why the goal could not be completed.',
          },
        },
        required: ['summary'],
      },
      category: 'utility',
      riskLevel: 'low',
      handler: async (args) => {
        const summary = String(args.summary ?? '');
        isComplete = true;
        completeSummary = summary;
        return { content: 'Marked as complete.' };
      },
    },
    {
      name: 'reportProgress',
      description: 'Report a progress update to the user.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The progress message to report.',
          },
        },
        required: ['message'],
      },
      category: 'utility',
      riskLevel: 'low',
      handler: async (args) => {
        const message = String(args.message ?? '');
        callbacks.onProgress?.(message);
        return { content: 'Progress reported.' };
      },
    },
    {
      name: 'requestUserInput',
      description: 'Ask the user a question and wait for their answer.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user.',
          },
        },
        required: ['question'],
      },
      category: 'utility',
      riskLevel: 'low',
      handler: async (args) => {
        const question = String(args.question ?? '');
        if (callbacks.onRequestInput) {
          const answer = await callbacks.onRequestInput(question);
          return { content: answer };
        }
        return { content: 'User input not available in this mode.' };
      },
    },
  ];

  // Wrap provided skills with tracking callbacks
  const wrappedSkills: SkillDefinition[] = skills.map((skill) => {
    const originalHandler = skill.handler;
    return {
      ...skill,
      handler: async (args: Record<string, unknown>) => {
        toolCallCount++;
        callbacks.onToolCall?.(skill.name, args);
        try {
          const result = await originalHandler(args);
          callbacks.onToolResult?.(skill.name, result.content, result.isError ?? false);
          return result;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          callbacks.onToolResult?.(skill.name, errMsg, true);
          return { content: errMsg, isError: true };
        }
      },
    };
  });

  // Also wrap control skills for consistent toolCallCount tracking
  const wrappedControlSkills: SkillDefinition[] = controlSkills.map((skill) => {
    const originalHandler = skill.handler;
    return {
      ...skill,
      handler: async (args: Record<string, unknown>) => {
        toolCallCount++;
        callbacks.onToolCall?.(skill.name, args);
        const result = await originalHandler(args);
        callbacks.onToolResult?.(skill.name, result.content, result.isError ?? false);
        return result;
      },
    };
  });

  const allSkills = [...wrappedControlSkills, ...wrappedSkills];

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: goal },
  ];

  let iteration = 0;
  let consecutiveEmptyRounds = 0;

  while (iteration < maxIterations) {
    if (abortSignal?.aborted) {
      break;
    }

    if (needsCompaction(messages)) {
      const beforeTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
      const compacted = await compactMessages(messages, adapter);
      const afterTokens = compacted.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);

      compacted.push({
        role: 'user',
        content: `[GOAL REMINDER] ${goal}`,
      });

      callbacks.onCompaction?.(beforeTokens, afterTokens);

      messages.length = 0;
      messages.push(...compacted);
    }

    const toolCountBefore = toolCallCount;

    let response;
    try {
      response = await adapter.complete({
        messages,
        skills: allSkills,
        timeoutMs,
        abortSignal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[agentLoop] adapter.complete error on iteration ${iteration}:`, errMsg);
      break;
    }

    const toolsUsedThisRound = toolCallCount - toolCountBefore;

    lastContent = response.content;
    messages.push({ role: 'assistant', content: response.content });
    callbacks.onResponse?.(response.content, iteration);

    if (isComplete) {
      break;
    }

    // Stuck detection: break only if no tools were called AND response is very short
    if (toolsUsedThisRound === 0 && response.content.trim().length < 5) {
      consecutiveEmptyRounds++;
      if (consecutiveEmptyRounds >= 2) {
        break;
      }
    } else {
      consecutiveEmptyRounds = 0;
    }

    messages.push({
      role: 'user',
      content: '[SYSTEM] Continue working on the goal. If you are done, call the markComplete skill with a summary.',
    });

    iteration++;
  }

  return {
    content: lastContent,
    iterations: iteration,
    completed: isComplete,
    summary: completeSummary,
    durationMs: Date.now() - startMs,
    toolCallCount,
  };
}
