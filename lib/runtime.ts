/**
 * Runtime: the single entry point every interface uses (CLI, HTTP API, web
 * UI, chat channels, scheduler). It owns sessions, runs turns one at a time
 * per session, fans out events, and routes approvals.
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { getConfig, PERMISSION_MODES, type Config, type PermissionMode } from './config';
import { McpManager, type McpServerStatus } from './mcp';
import { createProvider, listProviderStatus, resolveProvider, type ModelProvider } from './providers';
import { createSkillTool, discoverSkills, skillDirs, type SkillInfo } from './skills';
import { builtinTools, filterTools, toolSpec, type Tool } from './tools';
import { buildSystemPrompt } from './agent/systemPrompt';
import { compactHistory, estimateTokens } from './agent/compaction';
import { runTurn, type SessionState, type TurnHost, type TurnResult } from './agent/loop';
import { ApprovalBroker } from './sessions/approvals';
import { SessionStore, type SessionSummary, type StoredSession } from './sessions/store';
import { UsageStore } from './usage';
import { messageText, userMessage, type AgentEvent, type ImagePart, type Message, type PermissionDecision, type PermissionRequest } from './types';

export interface CreateSessionOptions {
  owner?: string;
  channel?: string;
  title?: string;
  model?: string;
  permissionMode?: PermissionMode;
  /** Extra system instructions for this session only. */
  instructions?: string;
  /** Earlier messages to seed the session with (stateless API compatibility). */
  history?: Message[];
}

export interface SendOptions {
  images?: ImagePart[];
  /** False for headless runs: tool calls that need approval are denied instead of waiting. */
  interactive?: boolean;
  onEvent?(event: AgentEvent): void;
}

interface LiveSession {
  state: SessionState;
  stored: Pick<StoredSession, 'header'>;
  queue: Promise<unknown>;
  running?: { controller: AbortController; events: AgentEvent[]; startedAt: string };
  subscribers: Set<(event: AgentEvent) => void>;
  /** Turns queued or running; idle sessions may be evicted from memory and reloaded from disk. */
  pending: number;
}

/** In-memory session limit; everything is on disk, so idle sessions are simply reloaded later. */
const MAX_LIVE_SESSIONS = 64;

/** The operator uses the CLI and the web UI as the same person, so they share memory notes. */
export function memoryScope(owner: string): string {
  return owner === 'web' || owner === 'local' ? 'local' : owner;
}

export interface SessionDetail {
  id: string;
  title: string;
  owner: string;
  channel?: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  permissionMode: PermissionMode;
  messages: StoredSession['transcript'];
  todos: SessionState['todos'];
  usage: StoredSession['usage'];
  costUsd: number;
  contextTokens?: number;
  running: boolean;
  pendingApprovals: PermissionRequest[];
}

const MAX_BUFFERED_EVENTS = 2000;

function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 57)}...` : line || '新しい会話';
}

export class Runtime {
  readonly store: SessionStore;
  readonly approvals = new ApprovalBroker();
  readonly usage: UsageStore;
  readonly mcp: McpManager;
  private readonly live = new Map<string, LiveSession>();
  private readonly providers = new Map<string, ModelProvider>();
  private readonly globalListeners = new Set<(sessionId: string, event: AgentEvent) => void>();

  constructor(readonly config: Config = getConfig(), options: { mcp?: McpManager } = {}) {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(config.workspace, { recursive: true });
    this.store = new SessionStore(config.dataDir);
    this.usage = new UsageStore(config.dataDir, config.pricing);
    this.mcp = options.mcp ?? new McpManager(config.mcpServers);
  }

  // ---- tools & providers ----------------------------------------------

  skills(): SkillInfo[] {
    return discoverSkills(skillDirs(this.config.projectRoot, this.config.dataDir));
  }

  /** Tools available to new sessions. */
  async tools(): Promise<Tool[]> {
    await this.mcp.start();
    const skills = this.skills();
    return filterTools([...builtinTools(), ...(skills.length ? [createSkillTool(skills)] : []), ...this.mcp.tools()], this.config.tools.disabled);
  }

  provider(modelRef: string): ModelProvider {
    let p = this.providers.get(modelRef);
    if (!p) {
      p = createProvider(resolveProvider(modelRef, this.config), this.config);
      this.providers.set(modelRef, p);
    }
    return p;
  }

  // ---- sessions -------------------------------------------------------

  async createSession(options: CreateSessionOptions = {}): Promise<string> {
    const id = `s_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const model = options.model?.trim() || this.config.model;
    const mode = options.permissionMode ?? this.config.permissions.mode;
    const owner = options.owner ?? 'local';
    const tools = await this.tools();
    const system = buildSystemPrompt({
      workspace: this.config.workspace,
      dataDir: this.config.dataDir,
      scope: memoryScope(owner),
      toolNames: tools.map(t => t.name),
      skills: this.skills(),
      extra: [this.config.systemPrompt, options.instructions].filter(Boolean).join('\n\n') || undefined,
      channel: options.channel,
    });
    const header = { id, title: titleFrom(options.title ?? ''), createdAt: new Date().toISOString(), owner, channel: options.channel, model };
    const toolSpecs = tools.map(toolSpec);
    await this.store.create(header, { system, tools: toolSpecs });
    if (mode !== this.config.permissions.mode) await this.store.append(id, { type: 'meta', at: new Date().toISOString(), permissionMode: mode });
    const history = options.history ?? [];
    for (const message of history) await this.store.append(id, { type: 'message', at: header.createdAt, message });
    this.remember(id, {
      state: { id, model, system, toolSpecs, messages: [...history], scope: memoryScope(owner), todos: [], sessionAllow: [], permissionMode: mode },
      stored: { header: { type: 'session', version: 2, ...header } },
      queue: Promise.resolve(),
      subscribers: new Set(),
      pending: 0,
    });
    return id;
  }

  private load(id: string): LiveSession | undefined {
    const existing = this.live.get(id);
    if (existing) {
      // Keep recently used sessions at the end of the map (LRU order).
      this.live.delete(id);
      this.live.set(id, existing);
      return existing;
    }
    const stored = this.store.load(id);
    if (!stored) return undefined;
    return this.remember(id, {
      state: {
        id, model: stored.model, system: stored.system, toolSpecs: stored.tools, messages: stored.messages,
        scope: memoryScope(stored.header.owner), todos: stored.todos, sessionAllow: stored.sessionAllow,
        permissionMode: stored.permissionMode ?? this.config.permissions.mode, contextTokens: stored.contextTokens,
      },
      stored: { header: stored.header },
      queue: Promise.resolve(),
      subscribers: new Set(),
      pending: 0,
    });
  }

  private remember(id: string, session: LiveSession): LiveSession {
    this.live.set(id, session);
    for (const [key, s] of this.live) {
      if (this.live.size <= MAX_LIVE_SESSIONS) break;
      if (s.pending === 0 && !s.running && s.subscribers.size === 0) this.live.delete(key);
    }
    return session;
  }

  exists(id: string): boolean {
    return this.live.has(id) || this.store.exists(id);
  }

  listSessions(filter: { owner?: string } = {}): Array<SessionSummary & { running: boolean }> {
    return this.store.list(filter).map(s => ({ ...s, running: Boolean(this.live.get(s.id)?.running) }));
  }

  getSession(id: string): SessionDetail | undefined {
    const stored = this.store.load(id);
    if (!stored) return undefined;
    const live = this.live.get(id);
    return {
      id,
      title: stored.header.title,
      owner: stored.header.owner,
      channel: stored.header.channel,
      createdAt: stored.header.createdAt,
      updatedAt: stored.updatedAt,
      model: live?.state.model ?? stored.model,
      permissionMode: live?.state.permissionMode ?? stored.permissionMode ?? this.config.permissions.mode,
      messages: stored.transcript,
      todos: live?.state.todos ?? stored.todos,
      usage: stored.usage,
      costUsd: stored.costUsd,
      contextTokens: live?.state.contextTokens ?? stored.contextTokens,
      running: Boolean(live?.running),
      pendingApprovals: this.approvals.list(id),
    };
  }

  /** Latest session of an owner, for "continue where I left off". */
  latestSession(owner: string): string | undefined {
    return this.store.list({ owner })[0]?.id;
  }

  async deleteSession(id: string): Promise<boolean> {
    this.cancel(id);
    this.live.delete(id);
    return this.store.delete(id);
  }

  async setModel(id: string, modelRef: string): Promise<void> {
    const s = this.require(id);
    const resolved = resolveProvider(modelRef, this.config);
    if (!resolved.configured) throw new Error(`${resolved.name} の認証情報がありません（${resolved.missing ?? 'API キー'}）。`);
    s.state.model = `${resolved.name}/${resolved.model}`;
    await this.store.append(id, { type: 'meta', at: new Date().toISOString(), model: s.state.model });
  }

  async setPermissionMode(id: string, mode: PermissionMode): Promise<void> {
    if (!PERMISSION_MODES.includes(mode)) throw new Error(`不明なモードです: ${mode}`);
    const s = this.require(id);
    s.state.permissionMode = mode;
    await this.store.append(id, { type: 'meta', at: new Date().toISOString(), permissionMode: mode });
  }

  private require(id: string): LiveSession {
    const s = this.load(id);
    if (!s) throw new Error(`セッションが見つかりません: ${id}`);
    return s;
  }

  // ---- events ---------------------------------------------------------

  subscribe(id: string, listener: (event: AgentEvent) => void, options: { replay?: boolean } = {}): () => void {
    const s = this.require(id);
    if (options.replay && s.running) for (const e of s.running.events) listener(e);
    s.subscribers.add(listener);
    return () => s.subscribers.delete(listener);
  }

  /** Observe events of every session (used by the scheduler and status views). */
  onAnyEvent(listener: (sessionId: string, event: AgentEvent) => void): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  isRunning(id: string): boolean {
    return Boolean(this.live.get(id)?.running);
  }

  cancel(id: string): boolean {
    const s = this.live.get(id);
    if (!s?.running) return false;
    s.running.controller.abort();
    return true;
  }

  resolveApproval(id: string, decision: PermissionDecision, by?: string): boolean {
    return this.approvals.resolve(id, decision, by);
  }

  // ---- turns ----------------------------------------------------------

  /** Create a session and send its first message. */
  async start(text: string, options: CreateSessionOptions & SendOptions = {}): Promise<{ sessionId: string; result: Promise<TurnResult> }> {
    const sessionId = await this.createSession({ ...options, title: options.title ?? text });
    return { sessionId, result: this.send(sessionId, text, options) };
  }

  /** Queue a user message; turns of one session never overlap. */
  send(id: string, text: string, options: SendOptions = {}): Promise<TurnResult> {
    const s = this.require(id);
    s.pending++;
    const run = s.queue
      .then(() => this.runOne(s, userMessage(text, options.images ?? []), options))
      .finally(() => { s.pending--; });
    s.queue = run.catch(() => undefined);
    return run;
  }

  async compact(id: string): Promise<{ beforeTokens: number; afterTokens: number }> {
    const s = this.require(id);
    if (s.running) throw new Error('実行中は圧縮できません。');
    const { state } = s;
    const before = state.contextTokens ?? estimateTokens(state.messages, state.system);
    const modelName = state.model.slice(state.model.indexOf('/') + 1);
    const { summary, usage } = await compactHistory({ provider: this.provider(state.model), model: modelName, system: state.system, tools: state.toolSpecs, messages: state.messages });
    if (usage) {
      const cost = await this.usage.record(state.model, usage);
      await this.store.append(id, { type: 'usage', at: new Date().toISOString(), model: state.model, usage, costUsd: cost });
    }
    state.messages = [summary];
    state.contextTokens = estimateTokens(state.messages, state.system);
    await this.store.append(id, { type: 'compaction', at: new Date().toISOString(), summary, beforeTokens: before });
    await this.store.append(id, { type: 'meta', at: new Date().toISOString(), contextTokens: state.contextTokens });
    return { beforeTokens: before, afterTokens: state.contextTokens };
  }

  private async runOne(s: LiveSession, input: Message, options: SendOptions): Promise<TurnResult> {
    const { state } = s;
    const controller = new AbortController();
    s.running = { controller, events: [], startedAt: new Date().toISOString() };
    const emit = (event: AgentEvent) => {
      const buf = s.running?.events;
      if (buf) {
        const last = buf[buf.length - 1];
        if (event.type === 'text_delta' && last?.type === 'text_delta' && last.agent === event.agent) buf[buf.length - 1] = { ...last, text: last.text + event.text };
        else if (buf.length < MAX_BUFFERED_EVENTS) buf.push(event);
      }
      options.onEvent?.(event);
      for (const sub of s.subscribers) { try { sub(event); } catch { /* ignore */ } }
      for (const l of this.globalListeners) { try { l(state.id, event); } catch { /* ignore */ } }
    };
    const now = () => new Date().toISOString();
    const persist = (record: Parameters<SessionStore['append']>[1]) => this.store.append(state.id, record);

    try {
      let provider: ModelProvider;
      try {
        provider = this.provider(state.model);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: 'turn_start', sessionId: state.id, model: state.model });
        emit({ type: 'notice', message });
        const result: TurnResult = { stopReason: 'error', text: '', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, error: message };
        emit({ type: 'turn_end', ...result });
        return result;
      }
      const allTools = await this.tools();
      const allowed = new Set(state.toolSpecs.map(t => t.name));
      const tools = allTools.filter(t => allowed.has(t.name));
      const modelName = state.model.slice(state.model.indexOf('/') + 1);

      const requestPermission = options.interactive === false ? undefined : async (request: PermissionRequest) => {
        // Register first so a listener may answer synchronously while handling the event.
        const pending = this.approvals.request(request, { timeoutMs: this.config.permissions.approvalTimeoutMs, signal: controller.signal });
        emit({ type: 'permission_request', request });
        const { decision, by } = await pending;
        emit({ type: 'permission_resolved', id: request.id, decision, by });
        return decision;
      };

      const host: TurnHost = {
        config: this.config,
        provider,
        modelName,
        tools,
        signal: controller.signal,
        emit,
        requestPermission,
        onMessage: message => persist({ type: 'message', at: now(), message }),
        onCompaction: (summary, beforeTokens) => persist({ type: 'compaction', at: now(), summary, beforeTokens }),
        onStateChange: patch => persist({ type: 'meta', at: now(), ...patch }),
        recordUsage: async usage => {
          const costUsd = await this.usage.record(state.model, usage);
          await persist({ type: 'usage', at: now(), model: state.model, usage, costUsd });
          return costUsd;
        },
        limitReached: () => this.usage.limitReached(this.config.limits),
      };
      host.runSubagent = (description, prompt) => this.runSubagent(state, host, tools, description, prompt);
      return await runTurn(state, input, host);
    } finally {
      s.running = undefined;
    }
  }

  private async runSubagent(parent: SessionState, parentHost: TurnHost, tools: Tool[], description: string, prompt: string): Promise<string> {
    const subTools = tools.filter(t => t.name !== 'task');
    const sub: SessionState = {
      id: `${parent.id}-sub`,
      model: parent.model,
      system: buildSystemPrompt({
        workspace: this.config.workspace, dataDir: this.config.dataDir, scope: parent.scope,
        toolNames: subTools.map(t => t.name), skills: this.skills(), extra: this.config.systemPrompt, subagent: true,
      }),
      toolSpecs: subTools.map(toolSpec),
      messages: [],
      scope: parent.scope,
      todos: [],
      sessionAllow: parent.sessionAllow,
      permissionMode: parent.permissionMode,
    };
    const result = await runTurn(sub, userMessage(prompt), {
      ...parentHost,
      tools: subTools,
      agent: description,
      maxTurns: Math.min(this.config.maxTurns, 30),
      runSubagent: undefined,
      onMessage: undefined,
      onCompaction: undefined,
      onStateChange: undefined,
      // The parent shows the sub-agent's tool activity, not its streamed text.
      emit: event => {
        if (event.type === 'text_delta' || event.type === 'reasoning_delta' || event.type === 'message' || event.type === 'todos') return;
        parentHost.emit(event);
      },
    });
    const note = result.stopReason === 'end_turn' ? '' : `\n\n（サブエージェントは ${result.stopReason} で終了しました${result.error ? `: ${result.error}` : ''}）`;
    return `${result.text}${note}`;
  }

  // ---- status ---------------------------------------------------------

  async status() {
    const tools = await this.tools();
    const resolved = resolveProvider(this.config.model, this.config);
    return {
      model: this.config.model,
      modelConfigured: resolved.configured,
      modelMissing: resolved.missing,
      providers: listProviderStatus(this.config),
      workspace: this.config.workspace,
      dataDir: this.config.dataDir,
      permissionMode: this.config.permissions.mode,
      permissionModes: PERMISSION_MODES,
      tools: tools.map(t => ({ name: t.name, access: t.access, description: t.description.split('。')[0] })),
      mcp: this.mcp.status() as McpServerStatus[],
      skills: this.skills().map(s => ({ name: s.name, description: s.description })),
      usageToday: this.usage.today(),
      limits: this.config.limits,
    };
  }

  async close(): Promise<void> {
    for (const s of this.live.values()) s.running?.controller.abort();
    await this.mcp.close();
    if ([...this.providers.values()].some(p => p.kind === 'copilot')) {
      const { stopCopilotClient } = await import('./providers/copilot');
      await stopCopilotClient();
    }
  }
}

const GLOBAL_KEY = Symbol.for('copharness.runtime');

/** Process-wide runtime (kept on globalThis so Next.js dev reloads share it). */
export function getRuntime(): Runtime {
  const g = globalThis as unknown as Record<symbol, Runtime | undefined>;
  g[GLOBAL_KEY] ??= new Runtime();
  return g[GLOBAL_KEY]!;
}

export function setRuntimeForTests(runtime: Runtime | undefined): void {
  (globalThis as unknown as Record<symbol, Runtime | undefined>)[GLOBAL_KEY] = runtime;
}

export { messageText };
