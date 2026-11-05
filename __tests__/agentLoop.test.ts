import * as fs from 'node:fs';
import * as path from 'node:path';
import { ScriptedProvider, call, testRuntime, text } from './helpers';
import type { AgentEvent } from '../lib/types';

describe('agent loop via Runtime', () => {
  it('answers without tools and persists the session', async () => {
    const provider = new ScriptedProvider([text('こんにちは！')]);
    const runtime = testRuntime(provider);
    const { sessionId, result } = await runtime.start('やあ');
    const r = await result;
    expect(r.stopReason).toBe('end_turn');
    expect(r.text).toBe('こんにちは！');
    const detail = runtime.getSession(sessionId)!;
    expect(detail.title).toBe('やあ');
    expect(detail.messages).toHaveLength(2);
    expect(runtime.listSessions()[0].id).toBe(sessionId);
  });

  it('runs read-only tools automatically and feeds results back', async () => {
    const provider = new ScriptedProvider([call('read_file', { path: 'note.txt' }), text('読みました')]);
    const runtime = testRuntime(provider);
    fs.writeFileSync(path.join(runtime.config.workspace, 'note.txt'), 'hello file');
    const events: AgentEvent[] = [];
    const { result } = await runtime.start('ファイルを読んで', { onEvent: e => events.push(e) });
    const r = await result;
    expect(r.text).toBe('読みました');
    const second = provider.requests[1];
    const toolResult = second.messages[second.messages.length - 1].content[0];
    expect(toolResult).toMatchObject({ type: 'tool_result', name: 'read_file' });
    expect((toolResult as { content: string }).content).toContain('hello file');
    expect(events.map(e => e.type)).toEqual(expect.arrayContaining(['turn_start', 'tool_call', 'tool_result', 'turn_end']));
  });

  it('keeps the system prompt and tool list identical across model calls', async () => {
    const provider = new ScriptedProvider([call('list_files', {}), text('ok'), text('second turn')]);
    const runtime = testRuntime(provider);
    const { sessionId, result } = await runtime.start('一覧');
    await result;
    await runtime.send(sessionId, 'もう一度');
    const [a, b, c] = provider.requests;
    expect(b.system).toBe(a.system);
    expect(c.system).toBe(a.system);
    expect(c.tools).toEqual(a.tools);
    // Append-only: every earlier message is replayed unchanged.
    expect(c.messages.slice(0, b.messages.length)).toEqual(b.messages);
  });

  it('asks for approval before writing files and honours the decision', async () => {
    const provider = new ScriptedProvider([call('write_file', { path: 'a.txt', content: 'x' }), text('done')]);
    const runtime = testRuntime(provider);
    const { result } = await runtime.start('書いて', {
      onEvent: e => { if (e.type === 'permission_request') runtime.resolveApproval(e.request.id, 'deny'); },
    });
    await result;
    expect(fs.existsSync(path.join(runtime.config.workspace, 'a.txt'))).toBe(false);
    const last = provider.requests[1].messages.at(-1)!.content[0] as { content: string; isError?: boolean };
    expect(last.isError).toBe(true);
    expect(last.content).toContain('拒否');
  });

  it('remembers "always allow" for the rest of the session', async () => {
    const provider = new ScriptedProvider([
      call('write_file', { path: 'a.txt', content: '1' }, 'c1'), text('one'),
      call('write_file', { path: 'b.txt', content: '2' }, 'c2'), text('two'),
    ]);
    const runtime = testRuntime(provider);
    let asked = 0;
    const onEvent = (e: AgentEvent) => {
      if (e.type === 'permission_request') { asked++; runtime.resolveApproval(e.request.id, 'allow_always'); }
    };
    const { sessionId, result } = await runtime.start('1', { onEvent });
    await result;
    await runtime.send(sessionId, '2', { onEvent });
    expect(asked).toBe(1);
    expect(fs.readFileSync(path.join(runtime.config.workspace, 'b.txt'), 'utf8')).toBe('2');
  });

  it('denies approval-requiring tools in headless runs', async () => {
    const provider = new ScriptedProvider([call('bash', { command: 'echo hi' }), text('could not')]);
    const runtime = testRuntime(provider);
    const { result } = await runtime.start('run', { interactive: false });
    await result;
    const last = provider.requests[1].messages.at(-1)!.content[0] as { content: string };
    expect(last.content).toContain('承認');
  });

  it('runs bash when the mode allows it', async () => {
    const provider = new ScriptedProvider([call('bash', { command: 'echo from-shell' }), text('ok')]);
    const runtime = testRuntime(provider);
    const { result } = await runtime.start('run', { permissionMode: 'bypass' });
    await result;
    const last = provider.requests[1].messages.at(-1)!.content[0] as { content: string };
    expect(last.content).toContain('from-shell');
    expect(last.content).toContain('[exit 0]');
  });

  it('reports invalid tool input back to the model', async () => {
    const provider = new ScriptedProvider([call('read_file', { path: 42 }), text('fixed')]);
    const runtime = testRuntime(provider);
    const { result } = await runtime.start('x');
    await result;
    const last = provider.requests[1].messages.at(-1)!.content[0] as { content: string; isError: boolean };
    expect(last.isError).toBe(true);
    expect(last.content).toContain('引数が不正');
  });

  it('stops at maxTurns', async () => {
    const steps = Array.from({ length: 5 }, (_, i) => call('list_files', {}, `c${i}`));
    const provider = new ScriptedProvider(steps);
    const runtime = testRuntime(provider, { maxTurns: 3 });
    const { result } = await runtime.start('loop');
    expect((await result).stopReason).toBe('max_turns');
    expect(provider.requests).toHaveLength(3);
  });

  it('cancels a running turn and closes the open tool round', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    const provider = new ScriptedProvider([call('bash', { command: 'sleep 5' }), text('never')]);
    const runtime = testRuntime(provider);
    const { sessionId, result } = await runtime.start('slow', {
      permissionMode: 'bypass',
      onEvent: e => { if (e.type === 'tool_call') release(); },
    });
    await gate;
    runtime.cancel(sessionId);
    const r = await result;
    expect(r.stopReason).toBe('cancelled');
    const msgs = runtime.getSession(sessionId)!.messages;
    const last = msgs.at(-1) as { role: string; content: Array<{ type: string }> };
    expect(last.role).toBe('user');
    expect(last.content[0].type).toBe('tool_result');
  });

  it('records todos from todo_write', async () => {
    const provider = new ScriptedProvider([
      call('todo_write', { todos: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'pending' }] }),
      text('planned'),
    ]);
    const runtime = testRuntime(provider);
    const { sessionId, result } = await runtime.start('plan');
    await result;
    expect(runtime.getSession(sessionId)!.todos).toHaveLength(2);
    // reload from disk
    const fresh = testRuntime(provider);
    (fresh as unknown as { store: unknown }).store = runtime.store;
    expect(runtime.store.load(sessionId)!.todos[0].content).toBe('a');
  });

  it('runs sub-agents with their own context', async () => {
    const provider = new ScriptedProvider([
      call('task', { description: 'investigate', prompt: 'find things' }),
      text('sub-agent result'),
      text('parent final'),
    ]);
    const runtime = testRuntime(provider);
    const { result } = await runtime.start('delegate');
    const r = await result;
    expect(r.text).toBe('parent final');
    const subRequest = provider.requests[1];
    expect(subRequest.messages).toHaveLength(1);
    expect(subRequest.tools.map(t => t.name)).not.toContain('task');
    const parentFollowUp = provider.requests[2].messages.at(-1)!.content[0] as { content: string };
    expect(parentFollowUp.content).toContain('sub-agent result');
  });

  it('compacts the whole history when the context is too large', async () => {
    const provider = new ScriptedProvider([text('first'), text('SUMMARY TEXT'), text('after compaction')]);
    const runtime = testRuntime(provider, { compaction: { thresholdTokens: 10 } });
    const { sessionId, result } = await runtime.start('hello there, this is long enough');
    await result;
    const events: AgentEvent[] = [];
    await runtime.send(sessionId, 'next', { onEvent: e => events.push(e) });
    expect(events.some(e => e.type === 'compaction')).toBe(true);
    const finalRequest = provider.requests[2];
    expect(finalRequest.messages).toHaveLength(2);
    expect((finalRequest.messages[0].content[0] as { text: string }).text).toContain('SUMMARY TEXT');
    expect(finalRequest.system).toBe(provider.requests[0].system);
    // The stored session reloads to the compacted history.
    expect(runtime.store.load(sessionId)!.messages).toHaveLength(3);
  });

  it('enforces the daily cost limit', async () => {
    const provider = new ScriptedProvider([text('x')]);
    const runtime = testRuntime(provider, { limits: { dailyTokens: 1 } });
    await runtime.usage.record('openai/test-model', { inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const { result } = await runtime.start('hi');
    expect((await result).stopReason).toBe('budget');
    expect(provider.requests).toHaveLength(0);
  });
});

describe('Runtime housekeeping', () => {
  it('shares memory between the CLI and the web UI but not with chat users', async () => {
    const { memoryScope } = await import('../lib/runtime');
    expect(memoryScope('web')).toBe('local');
    expect(memoryScope('local')).toBe('local');
    expect(memoryScope('discord:1')).toBe('discord:1');
  });

  it('evicts idle sessions from memory and reloads them from disk', async () => {
    const provider = new ScriptedProvider(Array.from({ length: 70 }, (_, i) => text(`r${i}`)));
    const runtime = testRuntime(provider);
    const ids: string[] = [];
    for (let i = 0; i < 70; i++) {
      const { sessionId, result } = await runtime.start(`m${i}`);
      await result;
      ids.push(sessionId);
    }
    const live = (runtime as unknown as { live: Map<string, unknown> }).live;
    expect(live.size).toBeLessThanOrEqual(64);
    expect(live.has(ids[0])).toBe(false);
    expect(runtime.getSession(ids[0])!.messages).toHaveLength(2);
  });
});
