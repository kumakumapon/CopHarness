/**
 * Unit tests for lib/history/trimmer
 */

import { estimateTokens, estimateMessageTokens, trimHistoryToTokenBudget } from '../../lib/history/trimmer';
import type { LLMMessage } from '../../lib/adapter';

// ── estimateTokens ────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ASCII text at roughly 4 chars per token', () => {
    // "hello" = 5 chars → ceil(5/4) = 2 tokens
    expect(estimateTokens('hello')).toBe(2);
    // 16 chars → 4 tokens
    expect(estimateTokens('hello world test')).toBe(4);
  });

  it('estimates Japanese text with more tokens per character than ASCII', () => {
    // Japanese characters are non-ASCII → ~1.5 chars/token
    const japanese = 'こんにちは'; // 5 chars → ceil(5/1.5) = 4
    const tokens = estimateTokens(japanese);
    expect(tokens).toBeGreaterThan(estimateTokens('hello')); // more tokens than 5 ASCII chars
  });

  it('handles mixed ASCII and Japanese text', () => {
    const mixed = 'Hello世界'; // 5 ASCII + 2 non-ASCII
    const tokens = estimateTokens(mixed);
    // ascii: 5/4=1.25, nonAscii: 2/1.5≈1.33 → ceil(2.58) = 3
    expect(tokens).toBe(3);
  });
});

// ── estimateMessageTokens ─────────────────────────────────────────────────────

describe('estimateMessageTokens', () => {
  it('adds overhead on top of content tokens', () => {
    const msg: LLMMessage = { role: 'user', content: 'hello' };
    // estimateTokens('hello') = 2, overhead = 4 → 6
    expect(estimateMessageTokens(msg)).toBe(6);
  });

  it('includes overhead even for an empty message', () => {
    const msg: LLMMessage = { role: 'assistant', content: '' };
    expect(estimateMessageTokens(msg)).toBe(4); // just overhead
  });
});

// ── trimHistoryToTokenBudget ──────────────────────────────────────────────────

/** Build a simple message array for testing. */
function makeHistory(turns: Array<[string, string]>): LLMMessage[] {
  return turns.map(([role, content]) => ({ role: role as LLMMessage['role'], content }));
}

describe('trimHistoryToTokenBudget', () => {
  it('does not modify history that fits within the budget', () => {
    const history = makeHistory([
      ['user', 'hi'],
      ['assistant', 'hello'],
    ]);
    trimHistoryToTokenBudget(history, 4000, 800);
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe('hi');
    expect(history[1].content).toBe('hello');
  });

  it('always preserves system messages regardless of budget', () => {
    const systemContent = 'You are a helpful assistant.';
    const history: LLMMessage[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: 'hi' },
    ];
    // Force very small budget to drop all non-system messages
    trimHistoryToTokenBudget(history, 0, 800);
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('system');
    expect(history[0].content).toBe(systemContent);
  });

  it('keeps newest messages and drops oldest when budget is exceeded', () => {
    // Each "WORD" is 1 token, so we can reason about counts precisely.
    // Use short unique tokens so we know which messages are kept.
    const history = makeHistory([
      ['user', 'A'.repeat(100)],       // old
      ['assistant', 'B'.repeat(100)],  // old
      ['user', 'C'.repeat(100)],       // recent
      ['assistant', 'D'.repeat(100)],  // most recent
    ]);

    // Each 100-char ASCII message = ceil(100/4)=25 tokens + 4 overhead = 29 tokens
    // Budget of 60 fits 2 messages (2 × 29 = 58) but not 3 (3 × 29 = 87)
    trimHistoryToTokenBudget(history, 60, 800);

    expect(history.map((m) => m.content[0])).toEqual(['C', 'D']);
  });

  it('truncates individual messages that exceed maxMessageTokens', () => {
    const longContent = 'A'.repeat(10000); // very long ASCII message
    const history: LLMMessage[] = [
      { role: 'user', content: longContent },
    ];
    // maxMessageTokens = 10 → binary search finds prefix with ≤10 tokens
    trimHistoryToTokenBudget(history, 4000, 10);

    expect(history).toHaveLength(1);
    expect(history[0].content.length).toBeLessThan(longContent.length);
    expect(history[0].content).toContain('…[省略]');
    // Verify the truncated content itself is within the token limit
    const truncatedText = history[0].content.replace('…[省略]', '');
    const { estimateTokens: et } = require('../../lib/history/trimmer');
    expect(et(truncatedText)).toBeLessThanOrEqual(10);
  });

  it('truncates non-ASCII messages accurately by token count', () => {
    // Japanese text: each char ~1/1.5 ≈ 0.67 tokens
    // 30 Japanese chars → ceil(30/1.5) = 20 tokens — should be truncated to 10
    const japaneseContent = 'あ'.repeat(30);
    const history: LLMMessage[] = [{ role: 'user', content: japaneseContent }];
    trimHistoryToTokenBudget(history, 4000, 10);

    expect(history[0].content).toContain('…[省略]');
    const truncatedText = history[0].content.replace('…[省略]', '');
    const { estimateTokens: et } = require('../../lib/history/trimmer');
    expect(et(truncatedText)).toBeLessThanOrEqual(10);
  });

  it('respects maxMessages ceiling even when budget allows more', () => {
    const history = makeHistory([
      ['user', 'one'],
      ['assistant', 'reply one'],
      ['user', 'two'],
      ['assistant', 'reply two'],
      ['user', 'three'],
      ['assistant', 'reply three'],
    ]);
    // Large budget, but cap at 4 messages
    trimHistoryToTokenBudget(history, 100_000, 800, 4);
    const nonSystem = history.filter((m) => m.role !== 'system');
    expect(nonSystem.length).toBe(4);
    // Should keep the 4 newest
    expect(nonSystem[0].content).toBe('two');
    expect(nonSystem[3].content).toBe('reply three');
  });

  it('keeps multiple system messages and counts only non-system against budget', () => {
    const history: LLMMessage[] = [
      { role: 'system', content: 'sys1' },
      { role: 'system', content: 'sys2' },
      { role: 'user', content: 'hello' },
    ];
    // Even with tiny budget (0), system messages survive
    trimHistoryToTokenBudget(history, 0, 800);
    const sys = history.filter((m) => m.role === 'system');
    expect(sys.length).toBe(2);
  });

  it('reads defaults from env vars when no args are passed', () => {
    const origBudget = process.env.HISTORY_TOKEN_BUDGET;
    const origMax = process.env.HISTORY_MAX_MESSAGE_TOKENS;
    try {
      // Set a very small budget via env var
      process.env.HISTORY_TOKEN_BUDGET = '10';
      process.env.HISTORY_MAX_MESSAGE_TOKENS = '5';

      const history = makeHistory([
        ['user', 'A'.repeat(1000)],
        ['assistant', 'short'],
      ]);
      trimHistoryToTokenBudget(history); // no explicit args

      // Long message should be truncated
      const userMsg = history.find((m) => m.role === 'user');
      if (userMsg) {
        expect(userMsg.content).toContain('…[省略]');
      }
    } finally {
      if (origBudget === undefined) delete process.env.HISTORY_TOKEN_BUDGET;
      else process.env.HISTORY_TOKEN_BUDGET = origBudget;
      if (origMax === undefined) delete process.env.HISTORY_MAX_MESSAGE_TOKENS;
      else process.env.HISTORY_MAX_MESSAGE_TOKENS = origMax;
    }
  });
});
