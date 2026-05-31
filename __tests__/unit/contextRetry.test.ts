/**
 * Unit tests for lib/utils/contextRetry
 */

import { isContextLengthError, buildFallbackMessages, withContextFallback } from '../../lib/utils/contextRetry';
import type { LLMMessage } from '../../lib/adapter';

// ── isContextLengthError ──────────────────────────────────────────────────────

describe('isContextLengthError', () => {
  const cases: [string, boolean][] = [
    // OpenAI
    ['context_length_exceeded', true],
    ['maximum context length is 4096 tokens', true],
    // Anthropic
    ['prompt is too long', true],
    // Generic
    ['context window exceeded', true],
    ['context length exceeded', true],
    ['too many tokens in request', true],
    ['request payload size exceeds the limit', true],
    // HTTP 400 + context keyword
    ["400 Bad Request: 'token' limit exceeded", true],
    // Negative cases
    ['connection refused', false],
    ['timeout', false],
    ['rate limit exceeded', false],
    ['401 unauthorized', false],
  ];

  test.each(cases)('message "%s" → %s', (msg, expected) => {
    const err = new Error(msg);
    expect(isContextLengthError(err)).toBe(expected);
  });

  it('returns false for non-Error values', () => {
    expect(isContextLengthError('context_length_exceeded')).toBe(false);
    expect(isContextLengthError(null)).toBe(false);
    expect(isContextLengthError(42)).toBe(false);
  });
});

// ── buildFallbackMessages ─────────────────────────────────────────────────────

describe('buildFallbackMessages', () => {
  const sys: LLMMessage = { role: 'system', content: 'You are helpful.' };
  const u1: LLMMessage = { role: 'user', content: 'first question' };
  const a1: LLMMessage = { role: 'assistant', content: 'first answer' };
  const u2: LLMMessage = { role: 'user', content: 'second question' };
  const a2: LLMMessage = { role: 'assistant', content: 'second answer' };

  it('keeps system messages and only the last user message', () => {
    const result = buildFallbackMessages([sys, u1, a1, u2, a2]);
    expect(result).toEqual([sys, u2]);
  });

  it('works without a system message', () => {
    const result = buildFallbackMessages([u1, a1, u2]);
    expect(result).toEqual([u2]);
  });

  it('returns only system messages when there are no user messages', () => {
    const result = buildFallbackMessages([sys, { role: 'assistant', content: 'hi' }]);
    expect(result).toEqual([sys]);
  });

  it('returns empty array for empty input', () => {
    expect(buildFallbackMessages([])).toEqual([]);
  });
});

// ── withContextFallback ───────────────────────────────────────────────────────

describe('withContextFallback', () => {
  const messages: LLMMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'old question' },
    { role: 'assistant', content: 'old answer' },
    { role: 'user', content: 'new question' },
  ];

  it('returns result immediately when no error occurs', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withContextFallback(fn, messages);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(messages);
  });

  it('retries with fallback messages on context-length error', async () => {
    const contextErr = new Error('maximum context length is 4096 tokens');
    const fn = jest.fn()
      .mockRejectedValueOnce(contextErr)
      .mockResolvedValueOnce('retry ok');

    const result = await withContextFallback(fn, messages);
    expect(result).toBe('retry ok');
    expect(fn).toHaveBeenCalledTimes(2);

    // Second call should receive only system + last user message
    const fallback = fn.mock.calls[1][0] as LLMMessage[];
    expect(fallback).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'new question' },
    ]);
  });

  it('re-throws non-context errors without retrying', async () => {
    const networkErr = new Error('connection refused');
    const fn = jest.fn().mockRejectedValue(networkErr);

    await expect(withContextFallback(fn, messages)).rejects.toThrow('connection refused');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-throws if the retry also fails', async () => {
    const contextErr = new Error('context_length_exceeded');
    const retryErr = new Error('still fails');
    const fn = jest.fn()
      .mockRejectedValueOnce(contextErr)
      .mockRejectedValueOnce(retryErr);

    await expect(withContextFallback(fn, messages)).rejects.toThrow('still fails');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
