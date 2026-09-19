import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import '../lib/skills/index';
import { diagnoseRuntime } from '../lib/diagnostics';
import { createAdapterWithFallback, resolveRuntimeConfig } from '../lib/adapterFactory';
async function main() {
  const checks = diagnoseRuntime();
  if (process.argv.includes('--connect')) {
    const check = checks.find(c => c.name === 'connection')!;
    let adapter;
    try {
      adapter = createAdapterWithFallback(resolveRuntimeConfig());
      await adapter.complete({ messages: [{ role: 'user', content: 'Reply OK.' }], skills: [], timeoutMs: 15_000 });
      check.status = 'ok'; check.detail = 'Provider responded'; check.fix = undefined;
    } catch { check.status = 'error'; check.detail = 'Provider request failed'; check.fix = 'Check provider credentials, endpoint, model and network.'; }
    finally { await adapter?.destroy?.(); }
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(checks, null, 2));
  else for (const check of checks) console.log(`[${check.status}] ${check.name}: ${check.detail}${check.fix ? '\n  ' + check.fix : ''}`);
  if (checks.some(c => c.status === 'error')) process.exitCode = 1;
}
main().catch(() => { console.error('Diagnostics failed; check configuration and storage permissions.'); process.exitCode = 1; });
