import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runtimeProfile } from '../../lib/core/runtimeProfile';
import type { LLMAdapter } from '../../lib/core/adapter';

const originalEnv = process.env;
let temp: string;
beforeEach(() => {
  process.env = { ...originalEnv, COPHARNESS_PROFILE: 'minimal' };
  delete process.env.ENABLED_SKILLS;
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'minimal-profile-'));
  process.env.DATA_DIR = path.join(temp, 'unused-data');
  jest.resetModules();
});
afterEach(() => {
  process.env = originalEnv;
  jest.dontMock('../../lib/runtime/fullBootstrap');
  jest.restoreAllMocks();
  fs.rmSync(temp, { recursive: true, force: true });
});

it('defaults to full and rejects unknown profiles', () => {
  delete process.env.COPHARNESS_PROFILE;
  expect(runtimeProfile()).toBe('full');
  process.env.COPHARNESS_PROFILE = 'typo';
  expect(runtimeProfile).toThrow('COPHARNESS_PROFILE');
});

it.each(['', 'none', 'calculator,currentDateTime'])('registers only selected core skills (%s), without evaluating the full bootstrap', async selection => {
  process.env.ENABLED_SKILLS = selection;
  jest.doMock('../../lib/runtime/fullBootstrap', () => { throw new Error('Optional modules must not load'); });
  require('../../lib/bootstrap');
  const { listSkills, listActiveSkills } = require('../../lib/core/skill') as typeof import('../../lib/core/skill');
  const names = selection === '' || selection === 'none' ? [] : ['calculator', 'currentDateTime'];
  expect(listSkills().map(s => s.name).sort()).toEqual(names);
  expect(listActiveSkills().map(s => s.name).sort()).toEqual(names);
  if (names.length) {
    const calculator = listActiveSkills().find(s => s.name === 'calculator')!;
    expect((await calculator.handler({ expression: '2+3' })).content).toContain('5');
    expect((await calculator.handler({})).isError).toBe(true);
  }
  expect(fs.existsSync(process.env.DATA_DIR!)).toBe(false);
});

it('rejects extension tools in minimal mode and retains full extension registration', () => {
  process.env.ENABLED_SKILLS = 'memorySearch';
  expect(() => require('../../lib/bootstrap')).toThrow('core skills only');
  jest.resetModules();
  process.env.COPHARNESS_PROFILE = 'full';
  require('../../lib/bootstrap');
  const { listSkills } = require('../../lib/core/skill') as typeof import('../../lib/core/skill');
  expect(listSkills().some(s => s.name === 'memorySearch')).toBe(true);
  expect(listSkills().some(s => s.name === 'spawnAgent')).toBe(true);
});

it('keeps tool policy enforcement without creating diagnostic records', async () => {
  process.env.ENABLED_SKILLS = 'calculator';
  process.env.TOOL_POLICY_FILE = path.join(temp, 'policy.json');
  fs.writeFileSync(process.env.TOOL_POLICY_FILE, JSON.stringify({ version: 1, defaultApprovalMode: 'deny', rules: [] }));
  require('../../lib/bootstrap');
  const { listActiveSkills } = require('../../lib/core/skill') as typeof import('../../lib/core/skill');
  expect((await listActiveSkills()[0].handler({ expression: '2+3' })).isError).toBe(true);
  expect(fs.existsSync(process.env.DATA_DIR!)).toBe(false);
});

it('enforces global, user and task budgets without telemetry or disk records', async () => {
  const { BudgetAdapter } = require('../../lib/core/adapters/budgetAdapter') as typeof import('../../lib/core/adapters/budgetAdapter');
  const { withSkillExecutionContext } = require('../../lib/core/utils/executionContext') as typeof import('../../lib/core/utils/executionContext');
  const { _resetBudgetsForTests } = require('../../lib/core/budget/budget') as typeof import('../../lib/core/budget/budget');
  for (const scope of ['BUDGET_MAX_TOKENS', 'BUDGET_USER_MAX_TOKENS', 'BUDGET_TASK_MAX_TOKENS']) {
    process.env[scope] = '5';
    _resetBudgetsForTests();
    const complete = jest.fn(async () => ({ content: 'ok', usage: { totalTokens: 5 } }));
    const adapter = new BudgetAdapter({ provider: 'openai', model: 'gpt-5-mini', complete });
    await withSkillExecutionContext({ personId: 'person', taskId: 'task' }, async () => {
      await adapter.complete({ messages: [] });
      await expect(adapter.complete({ messages: [] })).rejects.toThrow('budget has been exhausted');
    });
    expect(complete).toHaveBeenCalledTimes(1);
    delete process.env[scope];
  }
  expect(fs.existsSync(process.env.DATA_DIR!)).toBe(false);
});

it('enforces streaming budgets without telemetry', async () => {
  process.env.BUDGET_MAX_TOKENS = '3';
  const { BudgetAdapter } = require('../../lib/core/adapters/budgetAdapter') as typeof import('../../lib/core/adapters/budgetAdapter');
  const adapter = new BudgetAdapter({ provider: 'mock', model: 'mock', lastStreamUsage: { totalTokens: 3 },
    complete: async () => ({ content: 'unused' }), stream: async function* () { yield 'ok'; } });
  for await (const chunk of adapter.stream({ messages: [] })) expect(chunk).toBe('ok');
  await expect(adapter.complete({ messages: [] })).rejects.toThrow('budget has been exhausted');
  expect(fs.existsSync(process.env.DATA_DIR!)).toBe(false);
});

it('does not start watcher timers during server instrumentation in minimal mode', async () => {
  process.env.NEXT_RUNTIME = 'nodejs';
  jest.doMock('../../lib/extensions/automation/watchers/adapterDaemon', () => { throw new Error('Watcher module loaded'); });
  const { register } = require('../../instrumentation') as typeof import('../../instrumentation');
  await expect(register()).resolves.toBeUndefined();
  jest.dontMock('../../lib/extensions/automation/watchers/adapterDaemon');
});

it('limits Copilot SDK sessions to harness tools and disables SDK auto-compaction', async () => {
  const { mockCopilotSdk } = require('@github/copilot-sdk') as typeof import('../../__mocks__/copilot-sdk');
  mockCopilotSdk.reset();
  const { createSession } = require('../../lib/core/initCopilot') as typeof import('../../lib/core/initCopilot');
  const handler = jest.fn(async () => ({ content: '5' }));
  await createSession({ skills: [{ name: 'calculator', description: 'test', parameters: { type: 'object', properties: {} }, handler }] });
  const config = mockCopilotSdk.createSessionConfigs[0] as {
    availableTools: string[]; infiniteSessions: { enabled: boolean }; onPermissionRequest: () => { kind: string };
    tools: Array<{ handler: (args: Record<string, unknown>) => Promise<unknown> }>;
  };
  expect(config.availableTools).toEqual(['calculator']);
  expect(config).toMatchObject({ infiniteSessions: { enabled: false }, memory: { enabled: false },
    enableSessionStore: false, enableSkills: false, enableConfigDiscovery: false, enableFileHooks: false });
  expect(config.onPermissionRequest().kind).toContain('denied');
  await expect(config.tools[0].handler({})).resolves.toMatchObject({ textResultForLlm: '5', resultType: 'success' });
  expect(handler).toHaveBeenCalledTimes(1);
});

it('uses ephemeral services without loading identity, task, session or summarization extensions', async () => {
  for (const modulePath of ['../../lib/extensions/channels/identity/store', '../../lib/extensions/tasks/ledger', '../../lib/extensions/agents/sessions', '../../lib/extensions/agents/ralphLoop']) {
    jest.doMock(modulePath, () => { throw new Error('Persistent extension loaded'); });
  }
  const services = require('../../lib/runtime/services') as typeof import('../../lib/runtime/services');
  const adapter: LLMAdapter = { provider: 'mock', model: 'mock', complete: jest.fn(async request => {
    await request.skills?.find(s => s.name === 'markComplete')?.handler({ summary: 'done' });
    return { content: 'done' };
  }) };
  const identity = await services.resolveConversationKey('api', 'alice');
  expect(identity.personId).toBe('api:alice');
  const task = await services.startTask({ kind: 'agent' });
  await services.finishTask(task.id, 'succeeded');
  const result = await services.runAgentSession({ goal: 'finish', adapter, sessionId: 'test', owner: 'cli' });
  expect(result.stopReason).toBe('succeeded');
  expect(await services.runWithRalphLoop({ messages: [] }, adapter)).toEqual({ content: 'done' });
  expect(adapter.complete).toHaveBeenCalledTimes(2);
  expect(fs.existsSync(process.env.DATA_DIR!)).toBe(false);
});
