/**
 * Configuration: one optional `copharness.json` for structure, environment
 * variables (`.env.local`) for secrets and quick overrides.
 *
 * Resolution order (later wins): defaults → copharness.json → environment.
 * Legacy v1 variables (COPILOT_PROVIDER, COPILOT_MODEL, MCP_SERVERS, ...) are
 * still understood and reported as deprecation warnings.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type PermissionMode = 'default' | 'acceptEdits' | 'readonly' | 'bypass';
export const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'readonly', 'bypass'];

export type HookEvent = 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop';
export const HOOK_EVENTS: HookEvent[] = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface McpServerConfig {
  /** stdio server */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Streamable HTTP (or legacy SSE) server */
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface HookConfig {
  /** Regular expression matched against the tool name (PreToolUse / PostToolUse). */
  matcher?: string;
  command: string;
  timeoutMs?: number;
}

export type ProviderType = 'anthropic' | 'openai' | 'gemini' | 'copilot';

export interface ProviderConfig {
  type: ProviderType;
  baseUrl?: string;
  /** Name of the environment variable holding the key (preferred over `apiKey`). */
  apiKeyEnv?: string;
  apiKey?: string;
}

export interface Pricing { input: number; output: number; cacheRead?: number; cacheWrite?: number }

export interface Config {
  /** "provider/model", e.g. "anthropic/claude-opus-5-5", "openai/gpt-5-mini", "lmstudio/qwen3". */
  model: string;
  /** Directory the file and shell tools work in. */
  workspace: string;
  /** Sessions, memory, schedules, usage. */
  dataDir: string;
  projectRoot: string;
  /** Extra instructions appended to the built-in system prompt. */
  systemPrompt?: string;
  /** Max model calls per user turn. */
  maxTurns: number;
  maxOutputTokens?: number;
  requestTimeoutMs: number;
  effort?: Effort;
  permissions: {
    mode: PermissionMode;
    allow: string[];
    deny: string[];
    ask: string[];
    approvalTimeoutMs: number;
  };
  tools: { disabled: string[] };
  mcpServers: Record<string, McpServerConfig>;
  hooks: Partial<Record<HookEvent, HookConfig[]>>;
  providers: Record<string, ProviderConfig>;
  channels: {
    /** If set, only these users ("discord:123", "line:U...", "slack:U...") may talk to the bot. */
    allowedUsers?: string[];
    /** Users allowed to approve tool calls from chat with /approve. */
    approvers: string[];
  };
  limits: { dailyCostUsd?: number; dailyTokens?: number };
  compaction: { thresholdTokens: number };
  pricing: Record<string, Pricing>;
}

export interface LoadedConfig {
  config: Config;
  /** Path of copharness.json when one was found. */
  file?: string;
  warnings: string[];
}

type Env = Record<string, string | undefined>;

const CONFIG_FILE = 'copharness.json';

export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5-mini',
  gemini: 'gemini-2.5-flash',
  copilot: 'gpt-5-mini',
};

/** OpenAI-compatible endpoints that work with no extra configuration. */
export const PROVIDER_PRESETS: Record<string, ProviderConfig & { baseUrlEnv?: string; keyOptional?: boolean }> = {
  lmstudio: { type: 'openai', baseUrl: 'http://localhost:1234/v1', baseUrlEnv: 'LMSTUDIO_BASE_URL', keyOptional: true },
  lemonade: { type: 'openai', baseUrl: 'http://localhost:8000/api/v0', baseUrlEnv: 'LEMONADE_BASE_URL', keyOptional: true },
  ollama: { type: 'openai', baseUrl: 'http://localhost:11434/v1', baseUrlEnv: 'OLLAMA_BASE_URL', keyOptional: true },
  openrouter: { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' },
  github: { type: 'openai', baseUrl: 'https://models.github.ai/inference', apiKeyEnv: 'GITHUB_TOKEN' },
};

/** v1 variables that no longer have an effect; reported so a silent behaviour change is noticed. */
const REMOVED_ENV = [
  'COPHARNESS_PROFILE', 'ENABLED_SKILLS', 'HIL_ENABLED', 'TOOL_POLICY_FILE', 'FALLBACK_PROVIDERS',
  'EXECUTION_BACKEND', 'GENERATED_SKILL_EXECUTION', 'MEMORY_NUDGE_ENABLED', 'TRANSCRIPT_LOGGING',
  'OTEL_EXPORTER_OTLP_ENDPOINT', 'EVAL_CASES_FILE',
];

const PROVIDER_ALIASES: Record<string, string> = { antigravity: 'gemini', google: 'gemini', claude: 'anthropic' };

export function normalizeProviderName(name: string): string {
  const lower = name.trim().toLowerCase();
  return PROVIDER_ALIASES[lower] ?? lower;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function interpolate(value: string, env: Env): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name: string) => env[name] ?? '');
}

function interpolateRecord(record: Record<string, string> | undefined, env: Env) {
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, interpolate(String(v), env)]));
}

/** Pick a provider from the credentials that are present. */
export function detectProvider(env: Env): string {
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY || env.COPILOT_PROVIDER_API_KEY || env.COPILOT_API_KEY) return 'openai';
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.ANTIGRAVITY_API_KEY) return 'gemini';
  return 'copilot';
}

function inferProviderForModel(model: string, env: Env): string {
  if (/^claude-/i.test(model)) return 'anthropic';
  if (/^gemini-/i.test(model)) return 'gemini';
  return detectProvider(env);
}

export function parseModelRef(ref: string, env: Env = process.env): { provider: string; model: string } {
  const trimmed = ref.trim();
  const slash = trimmed.indexOf('/');
  if (slash > 0) {
    const provider = normalizeProviderName(trimmed.slice(0, slash));
    const model = trimmed.slice(slash + 1).trim();
    return { provider, model: model || DEFAULT_MODELS[provider] || 'default' };
  }
  if (!trimmed) {
    const provider = detectProvider(env);
    return { provider, model: DEFAULT_MODELS[provider] };
  }
  return { provider: inferProviderForModel(trimmed, env), model: trimmed };
}

/** v1 environment variables mapped onto the model reference. */
function legacyModel(env: Env, warnings: string[]): string | undefined {
  const legacyProvider = env.COPILOT_PROVIDER?.trim();
  const provider = legacyProvider ? normalizeProviderName(legacyProvider) : undefined;
  const perProvider: Record<string, string | undefined> = {
    openai: env.OPENAI_MODEL,
    anthropic: env.ANTHROPIC_MODEL,
    gemini: env.ANTIGRAVITY_MODEL || env.GEMINI_MODEL,
    lmstudio: env.LMSTUDIO_MODEL,
    lemonade: env.LEMONADE_MODEL,
  };
  const model = env.COPILOT_MODEL?.trim() || (provider ? perProvider[provider] : undefined);
  if (!provider && !model) return undefined;
  warnings.push('COPILOT_PROVIDER / COPILOT_MODEL は非推奨です。COPHARNESS_MODEL=provider/model を使ってください。');
  if (provider) return `${provider}/${model || DEFAULT_MODELS[provider] || 'default'}`;
  return model;
}

function legacyMcpServers(raw: string, warnings: string[]): Record<string, McpServerConfig> {
  warnings.push('MCP_SERVERS は非推奨です。copharness.json の mcpServers を使ってください。');
  let entries: Array<{ url: string; name?: string; headers?: Record<string, string> }> = [];
  if (raw.trim().startsWith('[')) {
    try { entries = JSON.parse(raw); } catch { warnings.push('MCP_SERVERS を JSON として解釈できませんでした。'); }
  } else {
    entries = list(raw).map(url => ({ url }));
  }
  const servers: Record<string, McpServerConfig> = {};
  entries.forEach((entry, i) => {
    if (entry?.url) servers[entry.name || `server${i + 1}`] = { url: entry.url, headers: entry.headers };
  });
  return servers;
}

function readConfigFile(file: string): Record<string, unknown> {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('top level must be an object');
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`${file} を読み込めません: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function loadConfig(options: { cwd?: string; env?: Env } = {}): LoadedConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const warnings: string[] = [];
  const explicit = env.COPHARNESS_CONFIG?.trim();
  const candidate = explicit ? path.resolve(cwd, explicit) : path.join(cwd, CONFIG_FILE);
  let file: string | undefined;
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(candidate)) {
    file = candidate;
    raw = readConfigFile(candidate);
  } else if (explicit) {
    throw new Error(`COPHARNESS_CONFIG で指定された ${candidate} が見つかりません。`);
  }

  const obj = (key: string) => (raw[key] && typeof raw[key] === 'object' ? raw[key] as Record<string, unknown> : {});
  const permissionsRaw = obj('permissions');
  const channelsRaw = obj('channels');
  const limitsRaw = obj('limits');

  const model = env.COPHARNESS_MODEL?.trim()
    || (typeof raw.model === 'string' ? raw.model : undefined)
    || legacyModel(env, warnings)
    || '';
  const { provider, model: modelName } = parseModelRef(model, env);

  const dataDir = path.resolve(cwd, env.COPHARNESS_DATA_DIR || env.DATA_DIR || (raw.dataDir as string) || 'data');
  if (env.SKILL_FILE_SANDBOX_DIR && !env.COPHARNESS_WORKSPACE) warnings.push('SKILL_FILE_SANDBOX_DIR は非推奨です。COPHARNESS_WORKSPACE を使ってください。');
  const workspace = path.resolve(cwd, env.COPHARNESS_WORKSPACE || env.SKILL_FILE_SANDBOX_DIR || (raw.workspace as string) || 'workspace');

  const mode = (env.COPHARNESS_PERMISSION_MODE || permissionsRaw.mode || 'default') as PermissionMode;
  if (!PERMISSION_MODES.includes(mode)) {
    throw new Error(`permissions.mode は ${PERMISSION_MODES.join(' / ')} のいずれかです（指定値: ${String(mode)}）`);
  }

  let mcpServers: Record<string, McpServerConfig> = {};
  const rawServers = obj('mcpServers');
  for (const [name, value] of Object.entries(rawServers)) {
    if (!value || typeof value !== 'object') continue;
    const server = value as McpServerConfig;
    if (!server.command && !server.url) {
      warnings.push(`mcpServers.${name}: command か url が必要です（無視しました）。`);
      continue;
    }
    mcpServers[name] = {
      ...server,
      url: server.url ? interpolate(server.url, env) : undefined,
      headers: interpolateRecord(server.headers, env),
      env: interpolateRecord(server.env, env),
    };
  }
  if (!Object.keys(rawServers).length && env.MCP_SERVERS?.trim()) mcpServers = legacyMcpServers(env.MCP_SERVERS, warnings);

  const hooks: Config['hooks'] = {};
  const hooksRaw = obj('hooks');
  for (const [event, value] of Object.entries(hooksRaw)) {
    if (!HOOK_EVENTS.includes(event as HookEvent)) {
      warnings.push(`hooks.${event} は未対応のイベントです（${HOOK_EVENTS.join(', ')}）。`);
      continue;
    }
    const entries = (Array.isArray(value) ? value : []).filter((h): h is HookConfig => Boolean(h && typeof h.command === 'string'));
    if (entries.length) hooks[event as HookEvent] = entries;
  }

  const providers: Record<string, ProviderConfig> = {};
  for (const [name, value] of Object.entries(obj('providers'))) {
    const p = value as ProviderConfig;
    if (!p || !['anthropic', 'openai', 'gemini', 'copilot'].includes(p.type)) {
      warnings.push(`providers.${name}.type は anthropic / openai / gemini / copilot のいずれかです（無視しました）。`);
      continue;
    }
    providers[name.toLowerCase()] = p;
  }

  const removed = REMOVED_ENV.filter(name => env[name]?.trim());
  if (removed.length) warnings.push(`${removed.join(', ')} は v2 では使われません（docs/MIGRATION.md を参照）。`);

  const legacyApprovers = list(env.AGENT_COMMAND_APPROVERS);
  if (legacyApprovers.length) warnings.push('AGENT_COMMAND_APPROVERS は非推奨です。channels.approvers を使ってください。');
  const legacyCost = num(env.BUDGET_MAX_COST_USD);
  const legacyTokens = num(env.BUDGET_MAX_TOKENS);
  if (legacyCost !== undefined || legacyTokens !== undefined) warnings.push('BUDGET_MAX_* は非推奨です。limits.dailyCostUsd / limits.dailyTokens を使ってください。');

  const systemPrompt = env.COPHARNESS_SYSTEM_PROMPT || env.COPILOT_SYSTEM_PROMPT || (raw.systemPrompt as string) || undefined;
  if (env.COPILOT_SYSTEM_PROMPT && !env.COPHARNESS_SYSTEM_PROMPT) warnings.push('COPILOT_SYSTEM_PROMPT は非推奨です。COPHARNESS_SYSTEM_PROMPT を使ってください。');

  const effort = (env.COPHARNESS_EFFORT || raw.effort) as Effort | undefined;
  if (effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) throw new Error(`effort は low / medium / high / xhigh / max のいずれかです（指定値: ${effort}）`);

  const allowedUsers = channelsRaw.allowedUsers === undefined ? undefined : list(channelsRaw.allowedUsers);

  const config: Config = {
    model: `${provider}/${modelName}`,
    workspace,
    dataDir,
    projectRoot: cwd,
    systemPrompt,
    maxTurns: num(env.COPHARNESS_MAX_TURNS) ?? num(env.AGENT_MAX_ITERATIONS) ?? num(raw.maxTurns) ?? 50,
    maxOutputTokens: num(raw.maxOutputTokens),
    requestTimeoutMs: num(env.COPHARNESS_TIMEOUT_MS) ?? num(env.COPILOT_TIMEOUT_MS) ?? num(raw.requestTimeoutMs) ?? 600_000,
    effort,
    permissions: {
      mode,
      allow: list(permissionsRaw.allow),
      deny: list(permissionsRaw.deny),
      ask: list(permissionsRaw.ask),
      approvalTimeoutMs: num(permissionsRaw.approvalTimeoutMs) ?? 10 * 60_000,
    },
    tools: { disabled: list(obj('tools').disabled) },
    mcpServers,
    hooks,
    providers,
    channels: {
      allowedUsers,
      approvers: [...list(channelsRaw.approvers), ...legacyApprovers],
    },
    limits: {
      dailyCostUsd: num(env.COPHARNESS_DAILY_COST_USD) ?? num(limitsRaw.dailyCostUsd) ?? legacyCost,
      dailyTokens: num(env.COPHARNESS_DAILY_TOKENS) ?? num(limitsRaw.dailyTokens) ?? legacyTokens,
    },
    compaction: { thresholdTokens: num(obj('compaction').thresholdTokens) ?? 120_000 },
    pricing: (obj('pricing') as Record<string, Pricing>),
  };
  if (config.maxTurns < 1) throw new Error('maxTurns は 1 以上にしてください。');
  return { config, file, warnings };
}

let cached: LoadedConfig | undefined;
let warned = false;

/** Process-wide configuration (loaded once; call reloadConfig() after editing). */
export function getConfig(): Config {
  if (!cached) {
    cached = loadConfig();
    if (!warned && cached.warnings.length) {
      warned = true;
      for (const w of cached.warnings) console.warn(`[copharness] ${w}`);
    }
  }
  return cached.config;
}

export function getLoadedConfig(): LoadedConfig {
  getConfig();
  return cached!;
}

export function reloadConfig(): Config {
  cached = undefined;
  return getConfig();
}

/** Test helper: install an explicit configuration. */
export function setConfigForTests(config: Config | undefined): void {
  cached = config ? { config, warnings: [] } : undefined;
}
