import {
  estimateConversationTokens,
  needsCompaction,
  compactMessages,
} from '../../lib/context/compactor';
import { runWithRalphLoop } from '../../lib/context/ralphLoop';
import type { LLMAdapter, LLMRequest, LLMResponse } from '../../lib/adapter';

// ---------------------------------------------------------------------------
// estimateConversationTokens
// ---------------------------------------------------------------------------

describe('estimateConversationTokens', () => {
  test('ignores system messages', () => {
    const msgs = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: 'Hello' },
    ];
    const withSys = estimateConversationTokens(msgs);
    const withoutSys = estimateConversationTokens([{ role: 'user', content: 'Hello' }]);
    expect(withSys).toBe(withoutSys);
  });

  test('increases with longer messages', () => {
    const short = [{ role: 'user' as const, content: 'Hi' }];
    const long = [{ role: 'user' as const, content: 'Hi '.repeat(200) }];
    expect(estimateConversationTokens(long)).toBeGreaterThan(estimateConversationTokens(short));
  });
});

// ---------------------------------------------------------------------------
// needsCompaction
// ---------------------------------------------------------------------------

describe('needsCompaction', () => {
  test('returns false for short conversations', () => {
    const msgs = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ];
    expect(needsCompaction(msgs)).toBe(false);
  });

  test('returns true when threshold is exceeded (forced via env)', () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '1';
    const msgs = [{ role: 'user' as const, content: 'Hello world this is a test.' }];
    expect(needsCompaction(msgs)).toBe(true);
    delete process.env.COMPACTOR_TOKEN_THRESHOLD;
  });
});

// ---------------------------------------------------------------------------
// compactMessages
// ---------------------------------------------------------------------------

function makeSummaryAdapter(summary: string): LLMAdapter {
  return {
    provider: 'mock',
    model: 'mock',
    async complete(): Promise<LLMResponse> {
      return { content: summary };
    },
  };
}

describe('compactMessages', () => {
  test('returns original messages when too few to compact', async () => {
    const msgs = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi' },
    ];
    const result = await compactMessages(msgs, makeSummaryAdapter('summary'), 4);
    expect(result).toEqual(msgs);
  });

  test('compacts old messages and preserves recent tail', async () => {
    const msgs = [
      { role: 'user' as const, content: 'msg1' },
      { role: 'assistant' as const, content: 'msg2' },
      { role: 'user' as const, content: 'msg3' },
      { role: 'assistant' as const, content: 'msg4' },
      { role: 'user' as const, content: 'msg5 – recent' },
      { role: 'assistant' as const, content: 'msg6 – recent' },
    ];
    const result = await compactMessages(msgs, makeSummaryAdapter('Summary of msgs 1-4'), 2);
    // Should have a summary message and the last 2 non-system messages
    const summary = result.find((m) => m.content.includes('[CONTEXT SUMMARY'));
    expect(summary).toBeDefined();
    const recentContents = result.map((m) => m.content);
    expect(recentContents).toContain('msg5 – recent');
    expect(recentContents).toContain('msg6 – recent');
    // Older messages should be gone
    expect(recentContents).not.toContain('msg1');
  });

  test('preserves system messages', async () => {
    const msgs = [
      { role: 'system' as const, content: 'System instruction' },
      { role: 'user' as const, content: 'u1' },
      { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'u2' },
      { role: 'assistant' as const, content: 'a2' },
      { role: 'user' as const, content: 'u3' },
      { role: 'assistant' as const, content: 'a3' },
    ];
    const result = await compactMessages(msgs, makeSummaryAdapter('summary'), 2);
    const sys = result.filter((m) => m.role === 'system');
    expect(sys.length).toBe(1);
    expect(sys[0].content).toBe('System instruction');
  });

  test('falls back to original messages on adapter failure', async () => {
    const failAdapter: LLMAdapter = {
      provider: 'mock',
      model: 'mock',
      async complete(): Promise<LLMResponse> {
        throw new Error('adapter failed');
      },
    };
    const msgs = [
      { role: 'user' as const, content: 'u1' },
      { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'u2' },
      { role: 'assistant' as const, content: 'a2' },
      { role: 'user' as const, content: 'u3' },
      { role: 'assistant' as const, content: 'a3' },
    ];
    const result = await compactMessages(msgs, failAdapter, 2);
    expect(result).toEqual(msgs);
  });
});

// ---------------------------------------------------------------------------
// runWithRalphLoop
// ---------------------------------------------------------------------------

describe('runWithRalphLoop', () => {
  test('passes through when no compaction needed', async () => {
    const adapter: LLMAdapter = {
      provider: 'mock',
      model: 'mock',
      async complete(req: LLMRequest): Promise<LLMResponse> {
        return { content: 'direct response' };
      },
    };
    const msgs = [{ role: 'user' as const, content: 'Hello' }];
    const resp = await runWithRalphLoop({ messages: msgs }, adapter);
    expect(resp.content).toBe('direct response');
  });

  test('applies compaction when threshold exceeded (via env)', async () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '1';
    let compactionCallCount = 0;
    const adapter: LLMAdapter = {
      provider: 'mock',
      model: 'mock',
      async complete(req: LLMRequest): Promise<LLMResponse> {
        compactionCallCount++;
        // The first call is the compaction summary call; the second is the actual response
        return { content: compactionCallCount === 1 ? 'Summary text' : 'Final response' };
      },
    };
    const msgs = [
      { role: 'user' as const, content: 'Hello world this is a long message' },
      { role: 'assistant' as const, content: 'Reply' },
      { role: 'user' as const, content: 'Another message' },
      { role: 'assistant' as const, content: 'Another reply' },
      { role: 'user' as const, content: 'Yet another message' },
    ];
    const resp = await runWithRalphLoop({ messages: msgs }, adapter, { originalGoal: 'Complete the task', maxCompactionRounds: 1 });
    expect(compactionCallCount).toBeGreaterThan(1); // At least one summary call
    expect(resp.content).toBe('Final response');
    delete process.env.COMPACTOR_TOKEN_THRESHOLD;
  });
});
