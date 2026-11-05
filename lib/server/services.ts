/** Start background services once per server process. */
import { getRuntime } from '../runtime';
import { getScheduler } from '../scheduler';
import { getAccessToken, webUrl } from './auth';

const KEY = Symbol.for('copharness.services');

export async function startServices(): Promise<void> {
  const g = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (g[KEY]) return;
  g[KEY] = true;
  let runtime;
  try {
    runtime = getRuntime();
  } catch (err) {
    console.error(`[copharness] 設定を読み込めません: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const { token, source } = getAccessToken(runtime.config.dataDir);
  console.info(`\n  CopHarness Web UI: ${source === 'env' ? `http://localhost:${process.env.PORT || 3000}/ （COPHARNESS_API_KEY でログイン）` : webUrl(token)}\n`);
  void runtime.mcp.start().then(() => {
    for (const s of runtime.mcp.status()) {
      if (s.state === 'failed') console.warn(`[mcp] ${s.name} に接続できません: ${s.error}`);
      else if (s.state === 'connected') console.info(`[mcp] ${s.name}: ${s.tools.length} ツール`);
    }
  });
  getScheduler(runtime).start();
  const discordToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (discordToken) {
    const { startDiscord } = await import('../channels/discord');
    startDiscord(runtime, discordToken).catch(err => console.error(`[discord] 接続に失敗しました: ${err instanceof Error ? err.message : String(err)}`));
  }
}
