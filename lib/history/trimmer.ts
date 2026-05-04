/**
 * Token-budget-aware conversation history trimming.
 *
 * Problem: naively keeping the last N messages ignores message length.
 * A single long assistant response (e.g. code blocks) can consume the same
 * tokens as ten short turns.  This module trims by *estimated token count*
 * instead, giving tighter, more predictable context-window usage.
 *
 * ## Token estimation
 * We use a character-count heuristic rather than a full tokeniser so that
 * no extra dependency is needed:
 *   - ASCII characters    → ~4 chars per token
 *   - Non-ASCII (CJK/etc) → ~1.5 chars per token  (Japanese/Chinese are
 *                             more densely tokenised than English)
 * This is intentionally conservative so the real request is reliably
 * within the budget.
 *
 * ## Environment variables
 *   HISTORY_TOKEN_BUDGET       – Token budget for non-system messages
 *                                (default: 4000)
 *   HISTORY_MAX_MESSAGE_TOKENS – Individual message length cap in tokens.
 *                                Messages exceeding this are truncated and
 *                                annotated.  (default: 800)
 */

import type { LLMMessage } from '../adapter';

// ── Token estimation ─────────────────────────────────────────────────────────

const ASCII_CHARS_PER_TOKEN = 4;
const NON_ASCII_CHARS_PER_TOKEN = 1.5;
/** Fixed overhead per message (role tag, delimiter, etc.) */
const MESSAGE_OVERHEAD_TOKENS = 4;
/** Suffix appended to truncated messages. */
const TRUNCATION_SUFFIX = '…[省略]';

/**
 * Estimate the number of tokens in a string.
 * Uses a character-class heuristic; intentionally conservative.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) {
      ascii++;
    } else {
      nonAscii++;
    }
  }
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + nonAscii / NON_ASCII_CHARS_PER_TOKEN);
}

/**
 * Estimate the token cost of one conversation message.
 * Includes a fixed per-message overhead for the role tag and delimiters.
 */
export function estimateMessageTokens(msg: LLMMessage): number {
  return estimateTokens(msg.content) + MESSAGE_OVERHEAD_TOKENS;
}

// ── Core trim function ───────────────────────────────────────────────────────

/**
 * Trim conversation history in place to fit within a token budget.
 *
 * Behaviour:
 * 1. System messages are always preserved (they never count towards the budget).
 * 2. Each non-system message whose content exceeds `maxMessageTokens` tokens
 *    is truncated to that limit (a suffix is appended to indicate truncation).
 * 3. Non-system messages are kept from *newest to oldest* until the budget
 *    is exhausted.  Older messages are dropped.
 * 4. As an additional safety ceiling, no more than `maxMessages` non-system
 *    messages are kept (useful when callers also enforce a count limit).
 *
 * @param history       - The history array to trim (modified in place).
 * @param tokenBudget   - Max token budget for non-system messages.
 *                        Defaults to HISTORY_TOKEN_BUDGET env var or 4000.
 * @param maxMessageTokens - Per-message token cap before truncation.
 *                           Defaults to HISTORY_MAX_MESSAGE_TOKENS env var or 800.
 * @param maxMessages   - Optional ceiling on the number of non-system messages
 *                        to keep (count-based safety limit).
 */
export function trimHistoryToTokenBudget(
  history: LLMMessage[],
  tokenBudget?: number,
  maxMessageTokens?: number,
  maxMessages?: number,
): void {
  const budget =
    tokenBudget ??
    (Number(process.env.HISTORY_TOKEN_BUDGET) || 4000);
  const maxMsgTokens =
    maxMessageTokens ??
    (Number(process.env.HISTORY_MAX_MESSAGE_TOKENS) || 800);

  const systemMessages = history.filter((m) => m.role === 'system');
  let nonSystem = history.filter((m) => m.role !== 'system');

  // Step 1 – truncate individual messages that are too long
  const maxChars = maxMsgTokens * ASCII_CHARS_PER_TOKEN; // conservative upper bound
  nonSystem = nonSystem.map((m) => {
    if (m.content.length <= maxChars) return m;
    return { ...m, content: m.content.slice(0, maxChars) + TRUNCATION_SUFFIX };
  });

  // Step 2 – keep messages from newest to oldest within the token budget
  let usedTokens = 0;
  const kept: LLMMessage[] = [];
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(nonSystem[i]);
    if (usedTokens + tokens > budget) break;
    if (maxMessages !== undefined && kept.length >= maxMessages) break;
    usedTokens += tokens;
    kept.unshift(nonSystem[i]);
  }

  history.length = 0;
  history.push(...systemMessages, ...kept);
}
