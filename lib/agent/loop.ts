/**
 * The agent loop. One user message starts a turn: the model is called, the
 * tools it asks for are run (subject to permissions and hooks), and the loop
 * repeats until the model answers without calling tools.
 *
 * The history is append-only: messages are never edited or reordered, an
 * interrupted tool round is closed with error results, and compaction
 * replaces the history as a whole. That keeps provider caches and reasoning
 * signatures valid.
 */
import { randomUUID } from 'node:crypto';
import type { Config, PermissionMode } from '../config';
import { runHooks } from '../hooks';
import { alwaysAllowRule, evaluatePermission } from '../permissions';
import type { ModelProvider, ModelEvent } from '../providers';
import { summarizeCall, truncateMiddle, validateInput, type Tool, type ToolContext } from '../tools/types';
import {
  addUsage, emptyUsage, messageText,
  type AgentEvent, type Message, type PermissionDecision, type PermissionRequest, type TodoItem,
  type ToolCallPart, type ToolResultPart, type ToolSpec, type TurnStopReason, type Usage,
} from '../types';
import { compactHistory, estimateTokens } from './compaction';

export interface SessionState {
  id: string;
  /** "provider/model" */
  model: string;
  system: string;
  toolSpecs: ToolSpec[];
  messages: Message[];
  scope: string;
  todos: TodoItem[];
  sessionAllow: string[];
  permissionMode: PermissionMode;
  /** Context size reported by the last model call. */
  contextTokens?: number;
}

export interface TurnHost {
  config: Config;
  provider: ModelProvider;
  /** Model id passed to the provider (without the "provider/" prefix). */
  modelName: string;
  tools: Tool[];
  signal: AbortSignal;
  emit(event: AgentEvent): void;
  /** Ask a person. Omitted when nobody can answer (headless runs): such calls are denied. */
  requestPermission?(request: PermissionRequest): Promise<PermissionDecision>;
  onMessage?(message: Message): void | Promise<void>;
  onCompaction?(summary: Message, beforeTokens: number): void | Promise<void>;
  onStateChange?(patch: Partial<Pick<SessionState, 'todos' | 'sessionAllow' | 'contextTokens'>>): void | Promise<void>;
  recordUsage?(usage: Usage): Promise<number | undefined>;
  limitReached?(): string | undefined;
  /** Runs a sub-agent (provided only for top-level agents). */
  runSubagent?(description: string, prompt: string): Promise<string>;
  /** Label attached to events from sub-agents. */
  agent?: string;
  maxTurns?: number;
}

export interface TurnResult {
  stopReason: TurnStopReason;
  text: string;
  usage: Usage;
  costUsd?: number;
  error?: string;
}

const MAX_TOOL_OUTPUT = 50_000;

const isAbort = (err: unknown) => err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));

export async function runTurn(state: SessionState, input: Message, host: TurnHost): Promise<TurnResult> {
  const { config } = host;
  const tag = host.agent ? { agent: host.agent } : {};
  let usage = emptyUsage();
  let cost: number | undefined;
  let finalText = '';

  const emit = (event: AgentEvent) => host.emit(event);
  const append = async (message: Message) => {
    state.messages.push(message);
    await host.onMessage?.(message);
  };
  const byName = new Map(host.tools.map(t => [t.name, t]));

  const finish = async (stopReason: TurnStopReason, error?: string): Promise<TurnResult> => {
    if (!host.agent && config.hooks.Stop?.length) {
      await runHooks(config.hooks, 'Stop', { sessionId: state.id, stopReason, text: finalText }, { cwd: config.projectRoot }).catch(() => undefined);
    }
    const result: TurnResult = { stopReason, text: finalText, usage, costUsd: cost, error };
    if (!host.agent) emit({ type: 'turn_end', ...result });
    return result;
  };

  const track = async (u: Usage) => {
    usage = addUsage(usage, u);
    const c = await host.recordUsage?.(u);
    if (c !== undefined) cost = (cost ?? 0) + c;
    emit({ type: 'usage', usage: u, costUsd: c });
  };

  const maybeCompact = async () => {
    const size = state.contextTokens ?? estimateTokens(state.messages, state.system);
    if (size < config.compaction.thresholdTokens || state.messages.length < 2) return;
    const { summary, usage: u } = await compactHistory({
      provider: host.provider, model: host.modelName, system: state.system,
      tools: state.toolSpecs, messages: state.messages, signal: host.signal,
    });
    if (u) await track(u);
    state.messages.splice(0, state.messages.length, summary);
    state.contextTokens = estimateTokens(state.messages, state.system);
    await host.onCompaction?.(summary, size);
    await host.onStateChange?.({ contextTokens: state.contextTokens });
    emit({ type: 'compaction', beforeTokens: size, afterTokens: state.contextTokens });
  };

  // ---- tool execution -------------------------------------------------
  const toolContext = (): ToolContext => ({
    sessionId: state.id,
    workspace: config.workspace,
    dataDir: config.dataDir,
    scope: state.scope,
    signal: host.signal,
    emit,
    setTodos: todos => {
      state.todos = todos;
      emit({ type: 'todos', todos });
      void host.onStateChange?.({ todos });
    },
    runSubagent: host.runSubagent,
  });

  const result = (call: ToolCallPart, content: string, isError = true): ToolResultPart =>
    ({ type: 'tool_result', toolCallId: call.id, name: call.name, content, ...(isError ? { isError: true } : {}) });

  const executeCall = async (call: ToolCallPart): Promise<ToolResultPart> => {
    const started = Date.now();
    const tool = byName.get(call.name);
    const done = (part: ToolResultPart) => {
      emit({ type: 'tool_result', id: call.id, name: call.name, content: part.content, isError: Boolean(part.isError), durationMs: Date.now() - started, ...tag });
      return part;
    };
    emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input, summary: summarizeCall(tool, call.input), ...tag });
    if (host.signal.aborted) return done(result(call, '中断されたため実行しませんでした。'));
    if (!tool) return done(result(call, `ツール "${call.name}" は現在利用できません。`));
    if ('__invalid_json__' in call.input) return done(result(call, 'ツール引数が正しい JSON ではありません。引数を見直して再度呼び出してください。'));
    const errors = validateInput(tool.inputSchema, call.input);
    if (errors.length) return done(result(call, `引数が不正です: ${errors.join('; ')}`));

    // Permission: rules and mode, then PreToolUse hooks, then a person if needed.
    let { verdict, reason } = evaluatePermission({
      tool, input: call.input, mode: state.permissionMode,
      rules: config.permissions, sessionAllow: state.sessionAllow,
    });
    if (verdict !== 'deny' && config.hooks.PreToolUse?.length) {
      const hook = await runHooks(config.hooks, 'PreToolUse', { sessionId: state.id, tool: call.name, input: call.input }, { cwd: config.projectRoot, toolName: call.name });
      for (const e of hook.errors) emit({ type: 'notice', message: e });
      if (hook.blocked) return done(result(call, `フックにより拒否されました: ${hook.blocked}`));
      if (hook.decision === 'deny') return done(result(call, `フックにより拒否されました: ${hook.reason ?? ''}`.trim()));
      if (hook.decision === 'allow' || hook.decision === 'ask') { verdict = hook.decision; reason = hook.reason ?? 'フックの判定'; }
    }
    if (verdict === 'deny') return done(result(call, `このツール呼び出しは許可されていません（${reason}）。`));
    if (verdict === 'ask') {
      if (!host.requestPermission) {
        return done(result(call, `承認が必要なツールですが、この実行では承認を受け付けられないため実行しませんでした（${reason}）。`));
      }
      const request: PermissionRequest = {
        id: `perm_${randomUUID().slice(0, 8)}`,
        sessionId: state.id,
        toolCallId: call.id,
        tool: call.name,
        input: call.input,
        summary: summarizeCall(tool, call.input),
        reason,
        createdAt: new Date().toISOString(),
      };
      const decision = await host.requestPermission(request);
      if (decision === 'deny') {
        return done(result(call, host.signal.aborted ? '中断されたため実行しませんでした。' : 'ユーザーがこのツール呼び出しを拒否しました。方針を変えるか、ユーザーに確認してください。'));
      }
      if (decision === 'allow_always') {
        const rule = alwaysAllowRule(tool, call.input);
        if (!state.sessionAllow.includes(rule)) {
          state.sessionAllow.push(rule);
          await host.onStateChange?.({ sessionAllow: [...state.sessionAllow] });
        }
      }
    }

    let output: ToolResultPart;
    try {
      const out = await tool.run(call.input, toolContext());
      output = result(call, truncateMiddle(out.content, MAX_TOOL_OUTPUT), Boolean(out.isError));
    } catch (err) {
      output = result(call, host.signal.aborted ? '中断されました。' : `ツールの実行に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (config.hooks.PostToolUse?.length) {
      const hook = await runHooks(config.hooks, 'PostToolUse',
        { sessionId: state.id, tool: call.name, input: call.input, output: output.content, isError: Boolean(output.isError) },
        { cwd: config.projectRoot, toolName: call.name });
      for (const e of hook.errors) emit({ type: 'notice', message: e });
      const notes = [...hook.additionalContext, ...(hook.blocked ? [hook.blocked] : [])];
      if (notes.length) output = { ...output, content: `${output.content}\n\n[フックからの補足]\n${notes.join('\n')}` };
    }
    return done(output);
  };

  /** Read-only calls next to each other run in parallel; everything else in order. */
  const executeAll = async (calls: ToolCallPart[]): Promise<ToolResultPart[]> => {
    const results: ToolResultPart[] = [];
    let i = 0;
    while (i < calls.length) {
      const batch = [calls[i]];
      if (byName.get(calls[i].name)?.access === 'read') {
        while (i + batch.length < calls.length && byName.get(calls[i + batch.length].name)?.access === 'read') batch.push(calls[i + batch.length]);
      }
      results.push(...await Promise.all(batch.map(executeCall)));
      i += batch.length;
    }
    return results;
  };

  // ---- the turn -------------------------------------------------------
  try {
    if (!host.agent) emit({ type: 'turn_start', sessionId: state.id, model: state.model });

    let prompt = input;
    if (!host.agent && config.hooks.UserPromptSubmit?.length) {
      const hook = await runHooks(config.hooks, 'UserPromptSubmit', { sessionId: state.id, prompt: messageText(input) }, { cwd: config.projectRoot });
      for (const e of hook.errors) emit({ type: 'notice', message: e });
      if (hook.blocked || hook.decision === 'deny') {
        emit({ type: 'notice', message: `フックによりメッセージが拒否されました: ${hook.blocked ?? hook.reason ?? ''}` });
        return await finish('blocked');
      }
      if (hook.additionalContext.length) {
        prompt = { ...input, content: [...input.content, { type: 'text', text: `\n\n<context>\n${hook.additionalContext.join('\n')}\n</context>` }] };
      }
    }

    await maybeCompact();
    await append(prompt);

    const onModelEvent = (e: ModelEvent) => emit({ ...e, ...tag });

    // Providers that run their own tool loop (GitHub Copilot).
    if (host.provider.runTurn) {
      let chain = Promise.resolve();
      const r = await host.provider.runTurn({
        model: host.modelName, system: state.system, messages: [...state.messages], tools: state.toolSpecs, signal: host.signal,
        onEvent: onModelEvent,
        executeTool: call => {
          // Serialize so each call and its result are appended as an adjacent pair.
          const run = chain.then(async () => {
            await append({ role: 'assistant', content: [call] });
            const out = await executeCall(call);
            await append({ role: 'user', content: [out] });
            return out;
          });
          chain = run.then(() => undefined, () => undefined);
          return run;
        },
      });
      await track(r.usage);
      if (host.signal.aborted) return await finish('cancelled');
      finalText = r.text;
      const message: Message = { role: 'assistant', content: [{ type: 'text', text: r.text }] };
      await append(message);
      emit({ type: 'message', message, ...tag });
      return await finish('end_turn');
    }

    const maxTurns = host.maxTurns ?? config.maxTurns;
    for (let step = 0; step < maxTurns; step++) {
      if (host.signal.aborted) return await finish('cancelled');
      const limit = host.limitReached?.();
      if (limit) {
        emit({ type: 'notice', message: limit });
        return await finish('budget', limit);
      }
      if (step > 0) await maybeCompact();

      const response = await host.provider.stream(
        { model: host.modelName, system: state.system, messages: state.messages, tools: state.toolSpecs, signal: host.signal },
        onModelEvent,
      );
      await append(response.message);
      emit({ type: 'message', message: response.message, ...tag });
      const u = response.usage;
      state.contextTokens = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens + u.outputTokens;
      await host.onStateChange?.({ contextTokens: state.contextTokens });
      await track(u);

      const text = messageText(response.message);
      if (text.trim()) finalText = text;
      const calls = response.message.content.filter((p): p is ToolCallPart => p.type === 'tool_call');

      if (!calls.length) {
        if (response.stopReason === 'pause_turn') continue;
        if (response.stopReason === 'refusal') return await finish('refusal');
        if (response.stopReason === 'max_tokens') return await finish('max_tokens');
        return await finish(host.signal.aborted ? 'cancelled' : 'end_turn');
      }

      const results = response.stopReason === 'max_tokens'
        // A call cut off at the output limit has incomplete input: report it instead of running it.
        ? calls.map(c => result(c, '出力上限に達したため引数が途中で切れています。内容を分割して再度呼び出してください。'))
        : await executeAll(calls);
      await append({ role: 'user', content: results });
      if (host.signal.aborted) return await finish('cancelled');
    }
    emit({ type: 'notice', message: `1ターンあたりの上限（${maxTurns} 回のモデル呼び出し）に達しました。続けるにはメッセージを送ってください。` });
    return await finish('max_turns');
  } catch (err) {
    // Close an open tool round so the history stays valid for the next turn.
    const last = state.messages[state.messages.length - 1];
    const open = last?.role === 'assistant' ? last.content.filter((p): p is ToolCallPart => p.type === 'tool_call') : [];
    if (open.length) {
      await append({ role: 'user', content: open.map(c => result(c, host.signal.aborted ? '中断されました。' : 'エラーにより実行されませんでした。')) })
        .catch(() => undefined);
    }
    if (host.signal.aborted || isAbort(err)) return finish('cancelled');
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: 'notice', message: `エラー: ${message}` });
    return finish('error', message);
  }
}
