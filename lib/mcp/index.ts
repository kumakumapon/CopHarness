import { registerSkill } from '../skill';
import { loadMcpSkills } from './skillBridge';
import type { McpServerConfig } from './types';

let _initPromise: Promise<void> | null = null;

function parseServers(): McpServerConfig[] {
  const raw = (process.env.MCP_SERVERS ?? '').trim();
  if (!raw) return [];

  // Support JSON array: [{"url":"...","name":"..."}]
  if (raw.startsWith('[')) {
    try {
      return JSON.parse(raw) as McpServerConfig[];
    } catch {
      console.warn('[MCP] Failed to parse MCP_SERVERS as JSON, falling back to comma-separated');
    }
  }

  // Comma-separated URLs
  return raw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
}

async function _init(): Promise<void> {
  const servers = parseServers();
  if (servers.length === 0) return;

  const results = await Promise.allSettled(
    servers.map((cfg) => loadMcpSkills(cfg)),
  );

  let registered = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const skill of result.value) {
        registerSkill(skill);
        registered++;
      }
    }
  }
  if (registered > 0) {
    console.info(`[MCP] Registered ${registered} skill(s) from ${servers.length} server(s)`);
  }
}

export async function initMcpSkills(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = _init();
  return _initPromise;
}
