/**
 * Tests for lib/context/compactor.ts and lib/context/ralphLoop.ts
 *
 * Covers:
 * - estimateConversationTokens: empty array, system-only, mixed messages
 * - needsCompaction: below threshold, above threshold, env var override
 * - compactMessages: short message passthrough, structure of compacted output,
 *   summary content, adapter error fallback
 * - runWithRalphLoop: direct path, compaction path, goal re-injection,
 *   maxCompactionRounds, context-length error handling, non-context error passthrough
 * - runPromptWithRalphLoop: message array construction, system prompt inclusion
 */

import {
  estimateConversationTokens,
  needsCompaction,
  compactMessages,
} from '../../lib/context/compactor';
import {
  runWithRalphLoop,
  runPromptWithRalphLoop,
} from '../../lib/context/ralphLoop';
import type { LLMAdapter, LLMMessage, LLMRequest, LLMResponse } from '../../lib/adapter';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/tasks/ledger', () => ({
  updateTaskMetadata: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/skills/executionContext', () => ({
  getSkillExecutionContext: jest.fn().mockReturnValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeMockAdapter(overrides?: Partial<LLMAdapter>): LLMAdapter {
  return {
    provider: 'test',
    model: 'test-model',
    complete: jest.fn().mockResolvedValue({ content: 'response', model: 'test-model' }),
    ...overrides,
  } as LLMAdapter;
}

/** Build a list of alternating user/assistant messages long enough to exceed a low threshold. */
function makeLongHistory(pairs = 6): LLMMessage[] {
  const msgs: LLMMessage[] = [];
  for (let i = 0; i < pairs; i++) {
    msgs.push({ role: 'user', content: `User message number ${i} with extra padding to bulk up token count` });
    msgs.push({ role: 'assistant', content: `Assistant reply number ${i} with extra padding to bulk up token count` });
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// afterEach: clean up env vars set inside individual tests
// ---------------------------------------------------------------------------

afterEach(() => {
  delete process.env.COMPACTOR_TOKEN_THRESHOLD;
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// estimateConversationTokens
// ---------------------------------------------------------------------------

describe('estimateConversationTokens', () => {
  it('returns 0 for an empty message array', () => {
    expect(estimateConversationTokens([])).toBe(0);
  });

  it('returns 0 for a system-only message array', () => {
    const msgs: LLMMessage[] = [
      { role: 'system', content: 'You are a very helpful assistant with a long system prompt.' },
    ];
    expect(estimateConversationTokens(msgs)).toBe(0);
  });

  it('only counts non-system messages', () => {
    const userMsg: LLMMessage = { role: 'user', content: 'Hello there' };
    const withSystem: LLMMessage[] = [
      { role: 'system', content: 'Ignore this long system message that should not count.' },
      userMsg,
    ];
    const withoutSystem: LLMMessage[] = [userMsg];
    expect(estimateConversationTokens(withSystem)).toBe(estimateConversationTokens(withoutSystem));
  });

  it('returns a positive number for non-system messages', () => {
    const msgs: LLMMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    expect(estimateConversationTokens(msgs)).toBeGreaterThan(0);
  });

  it('grows as message content grows', () => {
    const short: LLMMessage[] = [{ role: 'user', content: 'Hi' }];
    const long: LLMMessage[] = [{ role: 'user', content: 'Hi '.repeat(200) }];
    expect(estimateConversationTokens(long)).toBeGreaterThan(estimateConversationTokens(short));
  });
});

// ---------------------------------------------------------------------------
// needsCompaction
// ---------------------------------------------------------------------------

describe('needsCompaction', () => {
  it('returns false for a short conversation well below the default threshold', () => {
    const msgs: LLMMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ];
    // Default threshold is 3 000 tokens; two tiny messages cannot exceed it.
    expect(needsCompaction(msgs)).toBe(false);
  });

  it('returns true when conversation tokens exceed the default threshold', () => {
    // Force threshold to 1 so even one character triggers compaction.
    process.env.COMPACTOR_TOKEN_THRESHOLD = '1';
    const msgs: LLMMessage[] = [{ role: 'user', content: 'x' }];
    expect(needsCompaction(msgs)).toBe(true);
  });

  it('respects COMPACTOR_TOKEN_THRESHOLD env var (low value)', () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '5';
    const msgs: LLMMessage[] = [
      { role: 'user', content: 'This message is definitely more than five tokens long.' },
    ];
    expect(needsCompaction(msgs)).toBe(true);
  });

  it('respects COMPACTOR_TOKEN_THRESHOLD env var (high value)', () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '999999';
    const msgs = makeLongHistory(20);
    expect(needsCompaction(msgs)).toBe(false);
  });

  it('ignores system messages when calculating token usage', () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '1';
    // Only a system message — estimateConversationTokens returns 0 → needsCompaction false
    const msgs: LLMMessage[] = [
      { role: 'system', content: 'A huge system prompt '.repeat(1000) },
    ];
    expect(needsCompaction(msgs)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// compactMessages
// ---------------------------------------------------------------------------

describe('compactMessages', () => {
  it('returns the original array when message count is <= keepRecent', async () => {
    const msgs: LLMMessage[] = [
      { role: 'user', content: 'msg1' },
      { role: 'assistant', content: 'msg2' },
    ];
    const adapter = makeMockAdapter();
    const result = await compactMessages(msgs, adapter, 4);
    // Not enough messages to compact — should be the exact same reference or equal array
    expect(result).toEqual(msgs);
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it('calls adapter.complete() with a summary prompt when enough messages exist', async () => {
    const msgs: LLMMessage[] = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3 recent' },
      { role: 'assistant', content: 'a3 recent' },
    ];
    const adapter = makeMockAdapter({
      complete: jest.fn().mockResolvedValue({ content: 'A nice summary', model: 'test-model' }),
    });
    await compactMessages(msgs, adapter, 2);
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });

  it('produces a [system, summary, recent...] structure', async () => {
    const msgs: LLMMessage[] = [
      { role: 'system', content: 'System instruction' },
      { role: 'user', content: 'old-u1' },
      { role: 'assistant', content: 'old-a1' },
      { role: 'user', content: 'recent-u' },
      { role: 'assistant', content: 'recent-a' },
    ];
    const adapter = makeMockAdapter({
      complete: jest.fn().mockResolvedValue({ content: 'Summary here', model: 'test-model' }),
    });
    const result = await compactMessages(msgs, adapter, 2);

    // First message should be the system message
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('System instruction');

    // Second message should be the summary (assistant role)
    expect(result[1].content).toContain('[CONTEXT SUMMARY');

    // Recent messages should appear at the end
    const contents = result.map((m) => m.content);
    expect(contents).toContain('recent-u');
    expect(contents).toContain('recent-a');

    // Old messages should NOT be present verbatim
    expect(contents).not.toContain('old-u1');
    expect(contents).not.toContain('old-a1');
  });

  it('summary content starts with [CONTEXT SUMMARY', async () => {
    const msgs: LLMMessage[] = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
    ];
    const adapter = makeMockAdapter({
      complete: jest.fn().mockResolvedValue({ content: 'Summarised text', model: 'test-model' }),
    });
    const result = await compactMessages(msgs, adapter, 2);
    const summaryMsg = result.find((m) => m.content.startsWith('[CONTEXT SUMMARY'));
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg!.content).toContain('[CONTEXT SUMMARY');
  });

  it('falls back to original messages when adapter.complete() throws', async () => {
    const msgs: LLMMessage[] = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: 'a3' },
    ];
    const adapter = makeMockAdapter({
      complete: jest.fn().mockRejectedValue(new Error('summarisation adapter exploded')),
    });
    const result = await compactMessages(msgs, adapter, 2);
    expect(result).toEqual(msgs);
  });
});

// ---------------------------------------------------------------------------
// runWithRalphLoop
// ---------------------------------------------------------------------------

describe('runWithRalphLoop', () => {
  it('calls adapter.complete() directly when no compaction is needed', async () => {
    // High threshold → no compaction
    process.env.COMPACTOR_TOKEN_THRESHOLD = '999999';
    const adapter = makeMockAdapter();
    const msgs: LLMMessage[] = [{ role: 'user', content: 'Hello' }];
    const resp = await runWithRalphLoop({ messages: msgs }, adapter);
    expect(resp.content).toBe('response');
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });

  it('compacts and retries when needsCompaction returns true', async () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '1';
    let callCount = 0;
    const adapter = makeMockAdapter({
      complete: jest.fn().mockImplementation(async (req: LLMRequest) => {
        callCount++;
        const isCompaction = req.messages.some(
          (m) => m.role === 'system' && m.content.includes('summarisation assistant'),
        );
        return { content: isCompaction ? 'Summary' : 'Final answer', model: 'test-model' };
      }),
    });

    const resp = await runWithRalphLoop(
      { messages: makeLongHistory(3) },
      adapter,
      { originalGoal: 'Complete the task', maxCompactionRounds: 1 },
    );

    // Should have been called more than once (summary + final)
    expect(callCount).toBeGreaterThan(1);
    expect(resp.content).toBe('Final answer');
  });

  it('re-injects original goal after compaction', async () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '1';
    const capturedRequests: LLMRequest[] = [];
    const adapter = makeMockAdapter({
      complete: jest.fn().mockImplementation(async (req: LLMRequest) => {
        capturedRequests.push(req);
        const isCompaction = req.messages.some(
          (m) => m.role === 'system' && m.content.includes('summarisation assistant'),
        );
        return { content: isCompaction ? 'Summary text' : 'Done', model: 'test-model' };
      }),
    });

    await runWithRalphLoop(
      { messages: makeLongHistory(3) },
      adapter,
      { originalGoal: 'My important goal', maxCompactionRounds: 1 },
    );

    // Find the main (non-compaction) call
    const mainCall = capturedRequests.find((req) =>
      !req.messages.some(
        (m) => m.role === 'system' && m.content.includes('summarisation assistant'),
      ),
    );
    expect(mainCall).toBeDefined();
    const goalMsg = mainCall!.messages.find(
      (m) => m.role === 'user' && m.content.includes('My important goal'),
    );
    expect(goalMsg).toBeDefined();
    expect(goalMsg!.content).toContain('[GOAL REMINDER');
  });

  it('respects maxCompactionRounds and does not compact beyond the limit', async () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '1';
    let compactionCallCount = 0;
    const adapter = makeMockAdapter({
      complete: jest.fn().mockImplementation(async (req: LLMRequest) => {
        const isCompaction = req.messages.some(
          (m) => m.role === 'system' && m.content.includes('summarisation assistant'),
        );
        if (isCompaction) compactionCallCount++;
        return { content: isCompaction ? 'Summary' : 'Final', model: 'test-model' };
      }),
    });

    await runWithRalphLoop(
      { messages: makeLongHistory(3) },
      adapter,
      { originalGoal: 'Goal', maxCompactionRounds: 1 },
    );

    // With maxCompactionRounds: 1, compaction should happen at most once
    expect(compactionCallCount).toBeLessThanOrEqual(1);
  });

  it('catches context-length errors and triggers compaction', async () => {
    // High threshold so no pre-emptive compaction
    process.env.COMPACTOR_TOKEN_THRESHOLD = '999999';
    let callCount = 0;
    const adapter = makeMockAdapter({
      complete: jest.fn().mockImplementation(async (req: LLMRequest) => {
        callCount++;
        const isCompaction = req.messages.some(
          (m) => m.role === 'system' && m.content.includes('summarisation assistant'),
        );
        if (isCompaction) return { content: 'Summary', model: 'test-model' };
        if (callCount === 1) throw new Error('context_length_exceeded — please shorten your input');
        return { content: 'Recovered response', model: 'test-model' };
      }),
    });

    const resp = await runWithRalphLoop(
      { messages: makeLongHistory(3) },
      adapter,
      { originalGoal: 'Task goal', maxCompactionRounds: 1 },
    );

    expect(resp.content).toBe('Recovered response');
    // First call throws, subsequent compaction + retry brings callCount above 2
    expect(callCount).toBeGreaterThan(1);
  });

  it('re-throws non-context errors without compaction', async () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '999999';
    const adapter = makeMockAdapter({
      complete: jest.fn().mockRejectedValue(new Error('Network error: connection refused')),
    });

    await expect(
      runWithRalphLoop({ messages: [{ role: 'user', content: 'hello' }] }, adapter),
    ).rejects.toThrow('Network error: connection refused');

    // Only one call — error was not a context-length error
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });

  it('recognises various context-length error phrasings', async () => {
    const contextErrors = [
      'context length exceeded',
      'maximum context reached',
      'input too long for model',
      'max length reached',
      'maximum length reached',
      'token limit exceeded',
      'context_length_exceeded',
    ];

    for (const errorMsg of contextErrors) {
      process.env.COMPACTOR_TOKEN_THRESHOLD = '999999';
      let calls = 0;
      const adapter = makeMockAdapter({
        complete: jest.fn().mockImplementation(async (req: LLMRequest) => {
          calls++;
          const isCompaction = req.messages.some(
            (m) => m.role === 'system' && m.content.includes('summarisation assistant'),
          );
          if (isCompaction) return { content: 'Summary', model: 'test-model' };
          if (calls === 1) throw new Error(errorMsg);
          return { content: 'OK', model: 'test-model' };
        }),
      });

      const resp = await runWithRalphLoop(
        { messages: makeLongHistory(2) },
        adapter,
        { maxCompactionRounds: 1 },
      );
      expect(resp.content).toBe('OK');
    }
  });
});

// ---------------------------------------------------------------------------
// runPromptWithRalphLoop
// ---------------------------------------------------------------------------

describe('runPromptWithRalphLoop', () => {
  it('creates a user message from the prompt string', async () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '999999';
    const capturedRequests: LLMRequest[] = [];
    const adapter = makeMockAdapter({
      complete: jest.fn().mockImplementation(async (req: LLMRequest) => {
        capturedRequests.push(req);
        return { content: 'hello back', model: 'test-model' };
      }),
    });

    const result = await runPromptWithRalphLoop('Say hello', adapter);
    expect(result).toBe('hello back');

    const req = capturedRequests[0];
    const userMsg = req.messages.find((m) => m.role === 'user' && m.content === 'Say hello');
    expect(userMsg).toBeDefined();
  });

  it('includes a system message at position 0 when systemPrompt is provided', async () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '999999';
    const capturedRequests: LLMRequest[] = [];
    const adapter = makeMockAdapter({
      complete: jest.fn().mockImplementation(async (req: LLMRequest) => {
        capturedRequests.push(req);
        return { content: 'ok', model: 'test-model' };
      }),
    });

    await runPromptWithRalphLoop('Do the thing', adapter, 'You are a specialist.');

    const req = capturedRequests[0];
    expect(req.messages[0].role).toBe('system');
    expect(req.messages[0].content).toBe('You are a specialist.');
    expect(req.messages[1].role).toBe('user');
    expect(req.messages[1].content).toBe('Do the thing');
  });

  it('creates only a user message when no system prompt is given', async () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '999999';
    const capturedRequests: LLMRequest[] = [];
    const adapter = makeMockAdapter({
      complete: jest.fn().mockImplementation(async (req: LLMRequest) => {
        capturedRequests.push(req);
        return { content: 'done', model: 'test-model' };
      }),
    });

    await runPromptWithRalphLoop('Just a prompt', adapter);

    const req = capturedRequests[0];
    expect(req.messages.filter((m) => m.role === 'system')).toHaveLength(0);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
  });

  it('returns the string content of the LLM response', async () => {
    process.env.COMPACTOR_TOKEN_THRESHOLD = '999999';
    const adapter = makeMockAdapter({
      complete: jest.fn().mockResolvedValue({ content: 'The final answer is 42', model: 'test-model' }),
    });

    const result = await runPromptWithRalphLoop('What is the answer?', adapter);
    expect(result).toBe('The final answer is 42');
  });
});
