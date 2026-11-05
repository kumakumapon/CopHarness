/** Configuration checks shown by `npm run doctor` and the web UI status panel. */
import * as fs from 'node:fs';
import { getConfig, getLoadedConfig, type LoadedConfig } from './config';
import { resolveProvider } from './providers';
import type { Runtime } from './runtime';
import { accessTokenFile } from './server/auth';

export interface Check { level: 'ok' | 'warn' | 'error'; label: string; detail?: string }

function writable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** The file and warnings come from the process configuration when the runtime uses it. */
function loadedFor(runtime: Runtime): LoadedConfig {
  try {
    if (runtime.config === getConfig()) return getLoadedConfig();
  } catch { /* the process configuration is invalid; report on the runtime's own */ }
  return { config: runtime.config, warnings: [] };
}

export async function runDoctor(runtime: Runtime, loaded: LoadedConfig = loadedFor(runtime), env = process.env): Promise<Check[]> {
  const config = runtime.config;
  const checks: Check[] = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  checks.push(major >= 22
    ? { level: 'ok', label: `Node.js ${process.versions.node}` }
    : { level: 'error', label: `Node.js ${process.versions.node}`, detail: 'Node.js 22 以上が必要です' });
  void minor;

  checks.push(loaded.file
    ? { level: 'ok', label: '設定ファイル', detail: loaded.file }
    : { level: 'ok', label: '設定ファイル', detail: 'copharness.json なし（既定値と環境変数で動作）' });
  for (const w of loaded.warnings) checks.push({ level: 'warn', label: '非推奨の設定', detail: w });

  const p = resolveProvider(config.model, config, env);
  checks.push(p.configured
    ? { level: 'ok', label: `モデル ${config.model}`, detail: p.baseUrl ? `接続先 ${p.baseUrl}` : undefined }
    : { level: 'error', label: `モデル ${config.model}`, detail: `${p.missing ?? 'API キー'} を .env.local に設定してください` });
  if (p.type === 'copilot') checks.push({ level: 'warn', label: 'GitHub Copilot', detail: '`copilot login` 済みか COPILOT_GITHUB_TOKEN / GH_TOKEN が必要です' });

  checks.push(writable(config.workspace)
    ? { level: 'ok', label: 'ワークスペース', detail: config.workspace }
    : { level: 'error', label: 'ワークスペース', detail: `${config.workspace} に書き込めません` });
  checks.push(writable(config.dataDir)
    ? { level: 'ok', label: 'データディレクトリ', detail: config.dataDir }
    : { level: 'error', label: 'データディレクトリ', detail: `${config.dataDir} に書き込めません` });

  checks.push({ level: 'ok', label: `権限モード ${config.permissions.mode}`, detail: `allow ${config.permissions.allow.length} / ask ${config.permissions.ask.length} / deny ${config.permissions.deny.length}` });
  if (config.permissions.mode === 'bypass') checks.push({ level: 'warn', label: '権限モード bypass', detail: 'すべてのツールが確認なしで実行されます' });

  const tools = await runtime.tools();
  checks.push({ level: 'ok', label: `ツール ${tools.length} 個`, detail: tools.map(t => t.name).join(', ') });
  for (const s of runtime.mcp.status()) {
    checks.push(s.state === 'connected'
      ? { level: 'ok', label: `MCP ${s.name}`, detail: `${s.tools.length} ツール` }
      : s.state === 'disabled'
        ? { level: 'ok', label: `MCP ${s.name}`, detail: '無効化中' }
        : { level: 'error', label: `MCP ${s.name}`, detail: s.error ?? s.state });
  }
  const skills = runtime.skills();
  if (skills.length) checks.push({ level: 'ok', label: `スキル ${skills.length} 個`, detail: skills.map(s => s.name).join(', ') });

  checks.push(env.COPHARNESS_API_KEY
    ? { level: 'ok', label: 'API 認証', detail: 'COPHARNESS_API_KEY を使用' }
    : { level: 'ok', label: 'API 認証', detail: `自動生成トークン（${accessTokenFile(config.dataDir)}、npm run cli -- token で URL を表示）` });

  const pair = (a: string, b: string) => Boolean(env[a]) === Boolean(env[b]);
  if (env.DISCORD_BOT_TOKEN) checks.push({ level: 'ok', label: 'Discord', detail: 'サーバー起動時に接続します' });
  if (env.LINE_CHANNEL_SECRET || env.LINE_CHANNEL_ACCESS_TOKEN) {
    checks.push(pair('LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN')
      ? { level: 'ok', label: 'LINE', detail: 'Webhook: /api/line' }
      : { level: 'error', label: 'LINE', detail: 'LINE_CHANNEL_SECRET と LINE_CHANNEL_ACCESS_TOKEN の両方が必要です' });
  }
  if (env.SLACK_SIGNING_SECRET || env.SLACK_BOT_TOKEN) {
    checks.push(pair('SLACK_SIGNING_SECRET', 'SLACK_BOT_TOKEN')
      ? { level: 'ok', label: 'Slack', detail: 'Events API: /api/slack' }
      : { level: 'error', label: 'Slack', detail: 'SLACK_SIGNING_SECRET と SLACK_BOT_TOKEN の両方が必要です' });
  }
  if ((env.DISCORD_BOT_TOKEN || env.LINE_CHANNEL_SECRET || env.SLACK_BOT_TOKEN) && !config.channels.allowedUsers) {
    checks.push({ level: 'warn', label: 'チャット利用者', detail: 'channels.allowedUsers が未設定のため、ボットに話しかけた全員が利用できます' });
  }
  if (config.limits.dailyCostUsd === undefined && config.limits.dailyTokens === undefined) {
    checks.push({ level: 'ok', label: '日次上限', detail: '未設定（limits.dailyCostUsd で費用上限を設定できます）' });
  }
  return checks;
}
