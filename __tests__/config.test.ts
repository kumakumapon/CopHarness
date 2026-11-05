import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectProvider, loadConfig, parseModelRef } from '../lib/config';
import { resolveProvider } from '../lib/providers';
import { tempDir } from './helpers';

describe('model references', () => {
  it('parses provider/model and aliases', () => {
    expect(parseModelRef('anthropic/claude-sonnet-5-5', {})).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(parseModelRef('antigravity/gemini-2.5-pro', {})).toEqual({ provider: 'gemini', model: 'gemini-2.5-pro' });
    expect(parseModelRef('lmstudio/qwen3-8b', {})).toEqual({ provider: 'lmstudio', model: 'qwen3-8b' });
  });

  it('infers the provider from a bare model name or the available keys', () => {
    expect(parseModelRef('claude-opus-5-5', {}).provider).toBe('anthropic');
    expect(parseModelRef('gemini-2.5-flash', {}).provider).toBe('gemini');
    expect(parseModelRef('gpt-5', { OPENAI_API_KEY: 'k' }).provider).toBe('openai');
    expect(parseModelRef('', { ANTHROPIC_API_KEY: 'k' })).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(detectProvider({})).toBe('copilot');
  });
});

describe('loadConfig', () => {
  it('uses defaults when there is no config file', () => {
    const cwd = tempDir();
    const { config, file } = loadConfig({ cwd, env: { OPENAI_API_KEY: 'k' } });
    expect(file).toBeUndefined();
    expect(config.model).toBe('openai/gpt-5-mini');
    expect(config.workspace).toBe(path.join(cwd, 'workspace'));
    expect(config.dataDir).toBe(path.join(cwd, 'data'));
    expect(config.permissions.mode).toBe('default');
  });

  it('reads copharness.json and lets the environment override it', () => {
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, 'copharness.json'), JSON.stringify({
      model: 'anthropic/claude-sonnet-5-5',
      permissions: { mode: 'acceptEdits', allow: ['bash(git status)'], deny: ['bash(rm *)'] },
      mcpServers: { remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${MCP_TOKEN}' } }, broken: {} },
      hooks: { PreToolUse: [{ matcher: 'bash', command: 'true' }], Bogus: [] },
      limits: { dailyCostUsd: 3 },
    }));
    const { config, warnings } = loadConfig({ cwd, env: { COPHARNESS_MODEL: 'openai/gpt-5', MCP_TOKEN: 'secret' } });
    expect(config.model).toBe('openai/gpt-5');
    expect(config.permissions).toMatchObject({ mode: 'acceptEdits', allow: ['bash(git status)'], deny: ['bash(rm *)'] });
    expect(config.mcpServers.remote.headers).toEqual({ Authorization: 'Bearer secret' });
    expect(config.mcpServers.broken).toBeUndefined();
    expect(config.hooks.PreToolUse).toHaveLength(1);
    expect(config.limits.dailyCostUsd).toBe(3);
    expect(warnings.join('\n')).toMatch(/broken/);
    expect(warnings.join('\n')).toMatch(/Bogus/);
  });

  it('maps v1 environment variables and reports them as deprecated', () => {
    const { config, warnings } = loadConfig({
      cwd: tempDir(),
      env: {
        COPILOT_PROVIDER: 'antigravity', ANTIGRAVITY_MODEL: 'gemini-2.5-pro', GEMINI_API_KEY: 'k',
        MCP_SERVERS: 'http://localhost:3100,http://localhost:3101', BUDGET_MAX_COST_USD: '2',
        COPILOT_SYSTEM_PROMPT: 'be brief', AGENT_COMMAND_APPROVERS: 'discord:1',
      },
    });
    expect(config.model).toBe('gemini/gemini-2.5-pro');
    expect(Object.values(config.mcpServers).map(s => s.url)).toEqual(['http://localhost:3100', 'http://localhost:3101']);
    expect(config.limits.dailyCostUsd).toBe(2);
    expect(config.systemPrompt).toBe('be brief');
    expect(config.channels.approvers).toEqual(['discord:1']);
    expect(warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('warns about v1 variables that no longer have an effect', () => {
    const { warnings } = loadConfig({ cwd: tempDir(), env: { ENABLED_SKILLS: 'calculator', HIL_ENABLED: 'true', COPHARNESS_PROFILE: 'minimal' } });
    expect(warnings.join('\n')).toMatch(/COPHARNESS_PROFILE, ENABLED_SKILLS, HIL_ENABLED は v2 では使われません/);
  });

  it('rejects an unknown permission mode with a clear message', () => {
    expect(() => loadConfig({ cwd: tempDir(), env: { COPHARNESS_PERMISSION_MODE: 'yolo' } })).toThrow(/permissions.mode/);
  });

  it('reports a broken config file', () => {
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, 'copharness.json'), '{ nope');
    expect(() => loadConfig({ cwd, env: {} })).toThrow(/copharness.json/);
  });
});

describe('resolveProvider', () => {
  const providers = { local: { type: 'openai' as const, baseUrl: 'http://localhost:9999/v1' } };

  it('resolves presets without keys', () => {
    const r = resolveProvider('lmstudio/qwen3', { providers: {} }, {});
    expect(r).toMatchObject({ type: 'openai', configured: true, baseUrl: 'http://localhost:1234/v1', model: 'qwen3' });
    expect(resolveProvider('ollama/llama3', { providers: {} }, { OLLAMA_BASE_URL: 'http://gpu:11434/v1' }).baseUrl).toBe('http://gpu:11434/v1');
  });

  it('resolves custom providers from copharness.json', () => {
    expect(resolveProvider('local/my-model', { providers }, {})).toMatchObject({ type: 'openai', baseUrl: 'http://localhost:9999/v1', configured: true });
  });

  it('reports the missing credential', () => {
    expect(resolveProvider('anthropic/claude-opus-5-5', { providers: {} }, {})).toMatchObject({ configured: false, missing: 'ANTHROPIC_API_KEY' });
    expect(resolveProvider('openrouter/x', { providers: {} }, {})).toMatchObject({ configured: false, missing: 'OPENROUTER_API_KEY' });
    expect(resolveProvider('nope/x', { providers: {} }, {}).configured).toBe(false);
  });
});
