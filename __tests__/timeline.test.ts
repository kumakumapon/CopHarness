import { applyEvent, itemsFromTranscript, type Item } from '../app/_ui/timeline';
import type { AgentEvent } from '../lib/types';

describe('web UI timeline', () => {
  it('builds items from a stored transcript', () => {
    const items = itemsFromTranscript([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'let me look' }, { type: 'tool_call', id: 'a', name: 'bash', input: { command: 'ls' } }] },
      { role: 'user', content: [{ type: 'tool_result', toolCallId: 'a', name: 'bash', content: 'file.txt' }] },
      { compaction: true, at: '' },
      { role: 'user', content: [{ type: 'text', text: '[これまでの会話の要約]\nsummary' }] },
    ]);
    expect(items.map(i => i.kind)).toEqual(['user', 'assistant', 'tool', 'summary']);
    expect(items[1]).toMatchObject({ reasoning: 'thinking', text: 'let me look' });
    expect(items[2]).toMatchObject({ summary: 'ls', result: 'file.txt' });
    expect(items[3]).toMatchObject({ text: 'summary' });
  });

  it('applies streamed events in order', () => {
    const events: AgentEvent[] = [
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'tool_call', id: 't', name: 'write_file', input: { path: 'a' }, summary: 'a' },
      { type: 'permission_request', request: { id: 'p', sessionId: 's', toolCallId: 't', tool: 'write_file', input: {}, summary: 'a', reason: 'r', createdAt: '' } },
      { type: 'permission_resolved', id: 'p', decision: 'allow' },
      { type: 'tool_result', id: 't', name: 'write_file', content: 'ok', isError: false, durationMs: 5 },
      { type: 'text_delta', text: 'Done' },
      { type: 'text_delta', text: 'ignored', agent: 'sub' },
      { type: 'turn_end', stopReason: 'end_turn', text: 'Done', usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ];
    const items = events.reduce<Item[]>(applyEvent, []);
    expect(items.map(i => i.kind)).toEqual(['assistant', 'tool', 'approval', 'assistant', 'end']);
    expect(items[0]).toMatchObject({ text: 'Hello', streaming: false });
    expect(items[1]).toMatchObject({ result: 'ok' });
    expect(items[2]).toMatchObject({ decision: 'allow' });
    expect(items[3]).toMatchObject({ text: 'Done', streaming: false });
    expect(items[4]).toMatchObject({ tokens: 3 });
    // A duplicate approval (from polling) is ignored.
    expect(applyEvent(items, events[3])).toBe(items);
  });
});
