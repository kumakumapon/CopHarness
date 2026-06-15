/**
 * Context-length overflow detection and retry utility.
 *
 * Inspired by xangi's `isSessionRelatedError()` pattern:
 *   https://github.com/karaage0703/xangi/blob/main/src/local-llm/runner.ts
 *
 * When an LLM API call fails because the conversation history is too long,
 * this utility strips the old history down to just system messages + the last
 * user message and retries once.  This keeps the bot working after an overflow
 * instead of surfacing a raw error to the user.
 */

import type { LLMMessage } from '../adapter';

/**
 * Determine whether the error is caused by the conversation history being too
 * long for the model's context window.
 *
 * Covers the most common error shapes from OpenAI, Anthropic, and Gemini:
 *   - OpenAI:    `error.code === "context_length_exceeded"` or HTTP 400 body
 *                containing "maximum context length"
 *   - Anthropic: HTTP 400 with "prompt is too long"
 *   - Gemini:    "Request payload size exceeds the limit" or "context window"
 */
export function isContextLengthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('context_length_exceeded') ||
    msg.includes('maximum context length') ||
    msg.includes('prompt is too long') ||
    msg.includes('context window') ||
    msg.includes('context length') ||
    msg.includes('request payload size exceeds') ||
    msg.includes('max length reached') ||
    msg.includes('maximum length reached') ||
    msg.includes('too many tokens') ||
    msg.includes('max_tokens') ||
    msg.includes('invalid message') ||
    // HTTP 400 / 422 from Anthropic / Gemini for malformed or oversized payloads
    (msg.includes('400') && (msg.includes('token') || msg.includes('context') || msg.includes('prompt'))) ||
    (msg.includes('422') && (msg.includes('token') || msg.includes('message')))
  );
}

/**
 * Build a minimal fallback messages array that retains:
 *   1. All `system` messages (these are always required for correct model behaviour)
 *   2. The last `user` message only
 *
 * This is the xangi-inspired "nuke old history, keep latest prompt" strategy.
 */
export function buildFallbackMessages(messages: LLMMessage[]): LLMMessage[] {
  const systemMessages = messages.filter((m) => m.role === 'system');
  // Find the last user message
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  return lastUser ? [...systemMessages, lastUser] : systemMessages;
}

/**
 * Call `fn(messages)` and, if it throws a context-length error, retry once
 * with a stripped-down message array (system messages + last user message only).
 *
 * The retry is transparent: callers receive either the successful result or the
 * retry result.  If the retry also fails, that error is re-thrown.
 *
 * @param fn        - The function to call (usually an adapter's `complete` equivalent).
 * @param messages  - The full conversation history to pass on the first attempt.
 * @returns The result of `fn`.
 */
export async function withContextFallback<T>(
  fn: (messages: LLMMessage[]) => Promise<T>,
  messages: LLMMessage[],
): Promise<T> {
  try {
    return await fn(messages);
  } catch (err) {
    if (!isContextLengthError(err)) throw err;

    const fallback = buildFallbackMessages(messages);
    console.warn(
      `[contextRetry] Context length exceeded — retrying with ${fallback.length} message(s) ` +
        `(was ${messages.length}). Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fn(fallback);
  }
}
