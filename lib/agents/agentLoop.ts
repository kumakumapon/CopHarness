import type { LLMAdapter, LLMMessage } from '../adapter';
import type { SkillDefinition } from '../skill';
import { needsCompaction, compactMessages } from '../context/compactor';

export type AgentStopReason = 'succeeded' | 'failed' | 'cancelled' | 'iteration_limit' | 'stalled' | 'waiting_input';
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
  messages?: LLMMessage[];
  onCheckpoint?: (messages: LLMMessage[]) => void;
}
export interface AgentLoopResult {
  content: string;
  iterations: number;
  completed: boolean;
  stopReason: AgentStopReason;
  summary?: string;
  error?: string;
  pendingQuestion?: string;
  messages: LLMMessage[];
  durationMs: number;
  toolCallCount: number;
}
const DEFAULT_SYSTEM_PROMPT = `あなたは目標達成のために自律的に行動するエージェントです。
ツールを使って作業し、reportProgress で進捗を報告してください。
追加情報が必要なら requestUserInput を使い、回答を待ってください。
目標を達成した時だけ markComplete を呼んでください。
達成不能なら markFailed で理由を報告してください。保存されたツール結果を尊重し、副作用を重複実行しないでください。`;

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { goal, adapter, skills = [], systemPrompt = DEFAULT_SYSTEM_PROMPT,
    maxIterations = 25, timeoutMs = 120_000, callbacks = {}, abortSignal } = options;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 1000) {
    throw new Error('maxIterations must be an integer between 1 and 1000');
  }
  const startMs = Date.now();
  const messages: LLMMessage[] = options.messages?.length
    ? options.messages.map(m => ({ ...m }))
    : [{ role: 'system', content: systemPrompt }, { role: 'user', content: goal }];
  let terminal: AgentStopReason | undefined;
  let summary: string | undefined;
  let error: string | undefined;
  let pendingQuestion: string | undefined;
  let iterations = 0;
  let toolCallCount = 0;
  let content = '';
  let emptyRounds = 0;
  const checkpoint = () => options.onCheckpoint?.(messages.map(m => ({ ...m })));
  const control = (name: string, description: string, field: string,
    handler: SkillDefinition['handler']): SkillDefinition => ({
    name, description, category: 'utility', riskLevel: 'low', handler,
    parameters: { type: 'object', properties: { [field]: { type: 'string' } }, required: [field] },
  });
  const controls = [
    control('markComplete', 'Call only when the goal is fully achieved.', 'summary', async args => {
      // Accept explicit failure from older callers without reporting success.
      terminal = args.success === false ? 'failed' : 'succeeded';
      summary = String(args.summary ?? '');
      return { content: terminal };
    }),
    control('markFailed', 'Stop because the goal cannot be achieved; explain why.', 'summary', async args => {
      terminal = 'failed'; summary = String(args.summary ?? '');
      return { content: 'Marked as failed.' };
    }),
    control('reportProgress', 'Report progress to the user.', 'message', async args => {
      callbacks.onProgress?.(String(args.message ?? ''));
      return { content: 'Progress reported.' };
    }),
    control('requestUserInput', 'Ask a question and wait for the answer before continuing.', 'question', async args => {
      pendingQuestion = String(args.question ?? '');
      if (!callbacks.onRequestInput) {
        terminal = 'waiting_input';
        return { content: 'Waiting for user input. Stop calling tools.' };
      }
      // Cancellation must also interrupt an outstanding interactive question.
      let cancel: (() => void) | undefined;
      try {
        const answer = await Promise.race([
          callbacks.onRequestInput(pendingQuestion),
          new Promise<never>((_, reject) => {
            cancel = () => reject(new Error('Task cancelled'));
            abortSignal?.addEventListener('abort', cancel, { once: true });
            if (abortSignal?.aborted) cancel();
          }),
        ]);
        pendingQuestion = undefined;
        return { content: answer };
      } finally {
        if (cancel) abortSignal?.removeEventListener('abort', cancel);
      }
    }),
  ];
  const reserved = new Set(controls.map(s => s.name));
  const allSkills = [...controls, ...skills.filter(s => !reserved.has(s.name))].map(skill => ({
    ...skill,
    handler: async (args: Record<string, unknown>) => {
      if (abortSignal?.aborted || terminal) return { content: 'Agent stopped; tool not executed.', isError: true };
      toolCallCount++;
      callbacks.onToolCall?.(skill.name, args);
      let result;
      try { result = await skill.handler(args); }
      catch (err) {
        result = { content: err instanceof Error ? err.message : String(err), isError: true };
      }
      // Adapters keep their internal tool transcript private. Preserve results here
      // so a new completion after a restart can see work that already happened.
      messages.push({ role: 'assistant', content: `[TOOL RESULT] ${JSON.stringify({ skill: skill.name, args, ...result })}` });
      checkpoint();
      callbacks.onToolResult?.(skill.name, result.content, result.isError ?? false);
      return result;
    },
  }));
  try {
    checkpoint();
    while (iterations < maxIterations && !terminal) {
      if (abortSignal?.aborted) { terminal = 'cancelled'; break; }
      if (needsCompaction(messages)) {
        const before = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
        const compacted = await compactMessages(messages, adapter);
        const after = compacted.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
        messages.splice(0, messages.length, ...compacted, { role: 'user', content: `[GOAL REMINDER] ${goal}` });
        callbacks.onCompaction?.(before, after);
      }
      if (abortSignal?.aborted) { terminal = 'cancelled'; break; }
      const before = toolCallCount;
      iterations++;
      const response = await adapter.complete({ messages: messages.map(m => ({ ...m })), skills: allSkills, timeoutMs, abortSignal });
      content = response.content;
      messages.push({ role: 'assistant', content });
      callbacks.onResponse?.(content, iterations);
      if (abortSignal?.aborted) terminal = 'cancelled';
      emptyRounds = toolCallCount === before && content.trim().length < 5 ? emptyRounds + 1 : 0;
      if (!terminal && emptyRounds >= 2) terminal = 'stalled';
      if (!terminal) messages.push({ role: 'user', content: '[SYSTEM] Continue toward the goal. Use markComplete only for success, markFailed if impossible.' });
      checkpoint();
    }
  } catch (err) {
    terminal = abortSignal?.aborted ? 'cancelled' : 'failed';
    error = err instanceof Error ? err.message : String(err);
  }
  const stopReason = terminal ?? 'iteration_limit';
  return { content, iterations, completed: stopReason === 'succeeded', stopReason, summary, error,
    pendingQuestion, messages, durationMs: Date.now() - startMs, toolCallCount };
}
