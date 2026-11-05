import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHmac } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { runHooks } from '../lib/hooks';
import { McpManager, mcpToolName } from '../lib/mcp';
import { SessionStore } from '../lib/sessions/store';
import { ScheduleStore, Scheduler } from '../lib/scheduler';
import { ChannelGateway } from '../lib/channels/gateway';
import { verifyLineSignature } from '../lib/channels/line';
import { verifySlackSignature } from '../lib/channels/slack';
import { splitText } from '../lib/channels/notify';
import { ScriptedProvider, call, tempDir, testRuntime, text } from './helpers';

describe('hooks', () => {
  const cwd = tempDir();

  it('blocks with exit code 2 and passes stderr as the reason', async () => {
    const r = await runHooks({ PreToolUse: [{ matcher: 'bash', command: 'echo "no shell today" >&2; exit 2' }] }, 'PreToolUse', { tool: 'bash' }, { cwd, toolName: 'bash' });
    expect(r.blocked).toBe('no shell today');
  });

  it('reads JSON decisions and skips non-matching hooks', async () => {
    const hooks = { PreToolUse: [{ matcher: 'write_.*', command: 'echo \'{"decision":"allow","reason":"trusted"}\'' }] };
    expect((await runHooks(hooks, 'PreToolUse', {}, { cwd, toolName: 'write_file' })).decision).toBe('allow');
    expect((await runHooks(hooks, 'PreToolUse', {}, { cwd, toolName: 'bash' })).decision).toBeUndefined();
  });

  it('receives the payload on stdin and returns plain stdout as context', async () => {
    const r = await runHooks({ UserPromptSubmit: [{ command: 'cat | grep -o "secret-prompt"' }] }, 'UserPromptSubmit', { prompt: 'a secret-prompt here' }, { cwd });
    expect(r.additionalContext).toEqual(['secret-prompt']);
  });

  it('reports failing hooks without blocking', async () => {
    const r = await runHooks({ Stop: [{ command: 'exit 1' }] }, 'Stop', {}, { cwd });
    expect(r.blocked).toBeUndefined();
    expect(r.errors).toHaveLength(1);
  });

  it('can deny a tool call inside the agent loop', async () => {
    const provider = new ScriptedProvider([call('bash', { command: 'rm -rf /' }), text('ok')]);
    const runtime = testRuntime(provider, { permissions: { mode: 'bypass', allow: [], deny: [], ask: [], approvalTimeoutMs: 1000 }, hooks: { PreToolUse: [{ matcher: 'bash', command: 'grep -q "rm -rf" && { echo "dangerous" >&2; exit 2; } || exit 0' }] } });
    const { result } = await runtime.start('x');
    await result;
    const last = provider.requests[1].messages.at(-1)!.content[0] as { content: string };
    expect(last.content).toContain('dangerous');
  });
});

describe('MCP', () => {
  async function server() {
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    mcp.registerTool('add', { description: 'Add numbers', inputSchema: { a: z.number(), b: z.number() }, annotations: { readOnlyHint: true } },
      async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }));
    mcp.registerTool('fail', { description: 'Always fails', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'nope' }], isError: true }));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverSide);
    return clientSide;
  }

  it('exposes server tools as harness tools', async () => {
    const transport = await server();
    const manager = new McpManager({ calc: { command: 'unused' } }, () => transport);
    await manager.start();
    expect(manager.status()[0]).toMatchObject({ name: 'calc', state: 'connected', tools: ['mcp__calc__add', 'mcp__calc__fail'] });
    const [add, fail] = manager.tools();
    expect(add.access).toBe('read');
    expect(fail.access).toBe('execute');
    expect(add.inputSchema.properties).toHaveProperty('a');
    const ctx = { signal: new AbortController().signal } as Parameters<typeof add.run>[1];
    expect(await add.run({ a: 2, b: 3 }, ctx)).toEqual({ content: '5', isError: false });
    expect((await fail.run({}, ctx)).isError).toBe(true);
    await manager.close();
  });

  it('records connection failures instead of throwing', async () => {
    const manager = new McpManager({ broken: { command: 'x' }, off: { command: 'y', disabled: true } }, () => { throw new Error('spawn failed'); });
    await manager.start();
    expect(manager.status()).toEqual([
      expect.objectContaining({ name: 'broken', state: 'failed', error: 'spawn failed' }),
      expect.objectContaining({ name: 'off', state: 'disabled' }),
    ]);
    expect(manager.tools()).toEqual([]);
  });

  it('sanitizes tool names', () => {
    expect(mcpToolName('my server', 'do.thing')).toBe('mcp__my_server__do_thing');
    expect(mcpToolName('s', 'x'.repeat(100))).toHaveLength(64);
  });
});

describe('SessionStore', () => {
  it('appends, compacts, lists and survives a torn last line', async () => {
    const store = new SessionStore(tempDir());
    await store.create({ id: 's_test_0001', title: 'hello', createdAt: new Date().toISOString(), owner: 'local', model: 'openai/x' }, { system: 'sys', tools: [] });
    const msg = (t: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text: t }] });
    await store.append('s_test_0001', { type: 'message', at: '', message: msg('a') });
    await store.append('s_test_0001', { type: 'compaction', at: '', summary: msg('summary'), beforeTokens: 100 });
    await store.append('s_test_0001', { type: 'message', at: '', message: msg('b') });
    await store.append('s_test_0001', { type: 'usage', at: '', model: 'openai/x', usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0.5 });
    fs.appendFileSync(path.join(store.dir, 's_test_0001.jsonl'), '{"type":"mess');
    const loaded = store.load('s_test_0001')!;
    expect(loaded.messages.map(m => (m.content[0] as { text: string }).text)).toEqual(['summary', 'b']);
    expect(loaded.transcript).toHaveLength(3);
    expect(loaded.costUsd).toBe(0.5);
    expect(store.list()).toEqual([expect.objectContaining({ id: 's_test_0001', title: 'hello' })]);
    expect(() => store.load('../../etc/passwd')).not.toThrow();
    expect(store.load('../../etc/passwd')).toBeUndefined();
    expect(await store.delete('s_test_0001')).toBe(true);
  });
});

describe('scheduler', () => {
  it('reads v1 schedules and converts their delivery targets', () => {
    const dir = tempDir();
    const legacy = path.join(dir, 'legacy.json');
    fs.writeFileSync(legacy, JSON.stringify({ schedules: [{ id: 'old1', name: 'morning', cron: '09:30', prompt: 'p', enabled: true, discordChannelId: '123', runNow: false }] }));
    const store = new ScheduleStore(path.join(dir, 'data'), legacy);
    expect(store.list()[0]).toMatchObject({ id: 'old1', cron: '30 9 * * *', deliver: { channel: 'discord', to: '123' } });
    store.add({ cron: '0 8 * * *', prompt: 'new' });
    expect(store.list()).toHaveLength(2); // migrated into the new file
    expect(() => store.add({ cron: '0 25 * * *', prompt: 'x' })).toThrow(/cron/);
  });

  it('runs due schedules once per minute and records the result', async () => {
    const provider = new ScriptedProvider([text('morning report')]);
    const runtime = testRuntime(provider);
    const store = new ScheduleStore(runtime.config.dataDir);
    const s = store.add({ cron: '0 9 * * *', prompt: 'report' });
    const scheduler = new Scheduler(runtime, store);
    const nine = new Date(2026, 0, 5, 9, 0, 10);
    await scheduler.tick(nine);
    await scheduler.tick(new Date(2026, 0, 5, 9, 0, 40)); // same minute: no second run
    for (let i = 0; i < 50 && !store.find(s.id)?.lastStatus; i++) await new Promise(r => setTimeout(r, 20));
    const after = store.find(s.id)!;
    expect(after.lastStatus).toBe('end_turn');
    expect(runtime.getSession(after.lastSessionId!)?.owner).toBe(`schedule:${s.id}`);
    expect(provider.requests).toHaveLength(1);
  });
});

describe('chat gateway', () => {
  function setup(channels: { allowedUsers?: string[]; approvers: string[] }) {
    const provider = new ScriptedProvider([text('hi there'), call('write_file', { path: 'x.txt', content: '1' }), text('written')]);
    const runtime = testRuntime(provider, { channels });
    const gateway = new ChannelGateway(runtime);
    const sent: string[] = [];
    const reply = { send: async (t: string) => { sent.push(t); } };
    const msg = (t: string, userId = 'u1') => ({ channel: 'discord' as const, userId, conversationKey: 'discord:dm:u1', owner: 'discord:u1', text: t });
    return { runtime, gateway, sent, reply, msg };
  }

  it('answers, keeps one session per conversation and starts over on /new', async () => {
    const { runtime, gateway, sent, reply, msg } = setup({ approvers: [] });
    await gateway.handle(msg('hello'), reply);
    expect(sent).toEqual(['hi there']);
    const first = gateway.sessionFor('discord:dm:u1');
    expect(runtime.getSession(first!)?.channel).toBe('discord');
    await gateway.handle(msg('/new'), reply);
    expect(gateway.sessionFor('discord:dm:u1')).toBeUndefined();
  });

  it('rejects users outside allowedUsers', async () => {
    const { gateway, sent, reply, msg } = setup({ allowedUsers: ['discord:someone-else'], approvers: [] });
    await gateway.handle(msg('hello'), reply);
    expect(sent[0]).toContain('権限がありません');
  });

  it('lets approvers approve tool calls from chat', async () => {
    const { gateway, sent, reply, msg } = setup({ approvers: ['discord:u1'] });
    await gateway.handle(msg('hello'), reply);
    const approvingReply = {
      send: async (t: string) => {
        sent.push(t);
        const id = t.match(/\/approve (\S+)/)?.[1];
        if (id) await gateway.handle(msg(`/approve ${id}`), reply);
      },
    };
    await gateway.handle(msg('write it'), approvingReply);
    expect(sent.some(t => t.startsWith('承認しました'))).toBe(true);
    expect(sent.at(-1)).toBe('written');
  });

  it('refuses /approve from non-approvers', async () => {
    const { gateway, sent, reply, msg } = setup({ approvers: [] });
    await gateway.handle(msg('/approve perm_x'), reply);
    expect(sent[0]).toContain('承認する権限がありません');
  });
});

describe('webhook signatures', () => {
  it('verifies LINE signatures', () => {
    const body = '{"events":[]}';
    const sig = createHmac('sha256', 'secret').update(body).digest('base64');
    expect(verifyLineSignature(body, sig, 'secret')).toBe(true);
    expect(verifyLineSignature(body, sig, 'other')).toBe(false);
    expect(verifyLineSignature(body, null, 'secret')).toBe(false);
  });

  it('verifies Slack signatures and rejects stale requests', () => {
    const body = 'payload';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v0=${createHmac('sha256', 's').update(`v0:${ts}:${body}`).digest('hex')}`;
    expect(verifySlackSignature(body, ts, sig, 's')).toBe(true);
    expect(verifySlackSignature(body, ts, sig, 's', Date.now() + 10 * 60_000)).toBe(false);
    expect(verifySlackSignature(body, ts, 'v0=bad', 's')).toBe(false);
  });

  it('splits long replies on line boundaries', () => {
    const chunks = splitText(`${'a'.repeat(1500)}\n${'b'.repeat(1500)}`, 2000);
    expect(chunks).toHaveLength(2);
    expect(chunks.every(c => c.length <= 2000)).toBe(true);
  });
});

describe('delivery hardening', () => {
  it('rejects ids that could change the request path', async () => {
    const { deliver } = await import('../lib/channels/notify');
    await expect(deliver({ channel: 'discord', to: '123/../../users/@me' }, 'x', { DISCORD_BOT_TOKEN: 't' })).rejects.toThrow(/形式/);
  });

  it('refuses webhook deliveries to internal addresses', async () => {
    const { deliver } = await import('../lib/channels/notify');
    await expect(deliver({ channel: 'webhook', to: 'http://169.254.169.254/latest' }, 'x', {})).rejects.toThrow();
  });

  it('parses chat commands without regex backtracking on long input', async () => {
    const provider = new ScriptedProvider([]);
    const runtime = testRuntime(provider);
    const gateway = new ChannelGateway(runtime);
    const sent: string[] = [];
    const started = Date.now();
    await gateway.handle({ channel: 'discord', userId: 'u', conversationKey: 'k', owner: 'o', text: `/approve${' '.repeat(200_000)}x` }, { send: async t => { sent.push(t); } });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(sent[0]).toContain('承認する権限がありません'); // recognised as /approve with an argument
  });
});
