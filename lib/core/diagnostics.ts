import * as fs from 'fs';
import * as path from 'path';
import { resolveRuntimeConfig } from './adapterFactory';
import { listActiveSkills } from './skill';
import { getExecutionBackend } from './execution';
import { isHilEnabled } from './humanInLoop/gate';

export interface Diagnostic { name: string; status: 'ok' | 'warning' | 'error'; detail: string; fix?: string }
/** Do not include credential values or provider exception text in diagnostics. */
export function diagnoseRuntime(): Diagnostic[] {
  const config = resolveRuntimeConfig();
  const checks: Diagnostic[] = [
    { name: 'provider', status: config.configured ? 'ok' : 'error', detail: `${config.provider} / ${config.model}; credentials ${config.configured ? 'available or not required' : 'missing'}`, fix: config.configured ? undefined : 'Set the API key for the selected provider in .env.local.' },
    { name: 'connection', status: 'warning', detail: 'Not probed (offline diagnostics).', fix: 'Run npm run doctor -- --connect for a real provider request (may incur cost).' },
    { name: 'api-auth', status: process.env.COPHARNESS_API_KEY ? 'ok' : 'warning', detail: process.env.COPHARNESS_API_KEY ? 'API authentication enabled' : 'API authentication disabled', fix: process.env.COPHARNESS_API_KEY ? undefined : 'Set COPHARNESS_API_KEY before exposing HTTP endpoints.' },
    { name: 'approvals', status: isHilEnabled() ? 'ok' : 'warning', detail: isHilEnabled() ? 'HIL enabled; tool policy determines approvals' : 'HIL disabled; tool policy still applies', fix: 'Review HIL_ENABLED and TOOL_POLICY_FILE before enabling side-effect tools.' },
  ];
  const dir = path.resolve(process.env.DATA_DIR || process.cwd());
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
    checks.push({ name: 'storage', status: 'ok', detail: `${dir}; agent-sessions/ and conversations/` });
  } catch { checks.push({ name: 'storage', status: 'error', detail: 'Data directory is not writable', fix: 'Set DATA_DIR to a writable directory.' }); }
  try { checks.push({ name: 'backend', status: 'ok', detail: getExecutionBackend().kind + ' (configuration checked; connectivity not probed)' }); }
  catch { checks.push({ name: 'backend', status: 'error', detail: 'Invalid execution backend configuration', fix: 'Use EXECUTION_BACKEND=local|docker|ssh and configure the required container or SSH host.' }); }
  const skills = listActiveSkills();
  checks.push({ name: 'skills', status: 'ok', detail: skills.map(s => `${s.name} [${s.riskLevel ?? 'unknown'}]`).join(', ') || 'No available skills', fix: 'ENABLED_SKILLS unset exposes low-risk skills only. Set explicit names to enable additional tools.' });
  return checks;
}
