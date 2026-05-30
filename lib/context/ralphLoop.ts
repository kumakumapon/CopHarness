/**
 * Ralph Loop — Long-Horizon Continuity for agent sessions.
 *
 * Named after the "Ralph Wiggum Loop" pattern from agentic harness research:
 * when an agent tries to exit prematurely because its context is exhausted
 * (context anxiety), the harness intercepts, compacts the history, re-injects
 * the original goal, and allows the session to continue.
 *
 * Usage:
 *   const result = await runWithRalphLoop(messages, originalGoal, adapter);
 *
 * The loop applies compaction transparently if the conversation exceeds
 * the configured token threshold before completing.
 */

import type { LLMAdapter, LLMMessage, LLMRequest, LLMResponse } from '../adapter';
import { compactMessages, needsCompaction, writeProgressArtifact } from './compactor';

export interface RalphLoopOptions {
  /**
   * The original task goal to re-inject after compaction.
   * If omitted, goal re-injection is skipped.
   */
  originalGoal?: string;
  /** Whether to write a progress.md artefact on compaction. Defaults to false. */
  writeArtifact?: boolean;
  /** Maximum compaction rounds before giving up. Defaults to 2. */
  maxCompactionRounds?: number;
}

/**
 * Run an LLM request with automatic context compaction.
 *
 * If the conversation history exceeds the compaction threshold before or
 * during the call, old messages are summarised and the original goal is
 * re-appended so the agent can continue uninterrupted.
 *
 * Returns the final LLMResponse. Falls back to a direct adapter.complete()
 * call if compaction is not needed.
 */
export async function runWithRalphLoop(
  request: LLMRequest,
  adapter: LLMAdapter,
  options: RalphLoopOptions = {},
): Promise<LLMResponse> {
  const {
    originalGoal,
    writeArtifact = false,
    maxCompactionRounds = 2,
  } = options;

  let messages = [...request.messages];
  let compactionRounds = 0;

  while (compactionRounds <= maxCompactionRounds) {
    if (needsCompaction(messages) && compactionRounds < maxCompactionRounds) {
      compactionRounds++;

      const compacted = await compactMessages(messages, adapter);

      // Re-inject the original goal so the agent doesn't forget its purpose
      if (originalGoal) {
        compacted.push({
          role: 'user',
          content:
            `[GOAL REMINDER — context was compacted to free space]\n${originalGoal}`,
        });
      }

      if (writeArtifact && originalGoal) {
        const summary = compacted.find((m) => m.content.startsWith('[CONTEXT SUMMARY'))?.content ?? '';
        await writeProgressArtifact(originalGoal, summary);
      }

      messages = compacted;
    }

    try {
      const resp = await adapter.complete({ ...request, messages });
      return resp;
    } catch (err) {
      // If the error looks like a context-length error, try one more compaction round
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isContextError =
        msg.includes('context length') ||
        msg.includes('maximum context') ||
        msg.includes('too long') ||
        msg.includes('token limit') ||
        msg.includes('context_length_exceeded');

      if (isContextError && compactionRounds < maxCompactionRounds) {
        compactionRounds++;
        messages = await compactMessages(messages, adapter);
        if (originalGoal) {
          messages.push({
            role: 'user',
            content: `[GOAL REMINDER — context was compacted due to length error]\n${originalGoal}`,
          });
        }
        continue;
      }

      throw err;
    }
  }

  // Exhausted compaction rounds — call directly as a last resort
  return adapter.complete({ ...request, messages });
}

/**
 * Convenience wrapper: run a single user prompt through the Ralph Loop.
 * Creates a minimal messages array from the prompt and optional system message.
 */
export async function runPromptWithRalphLoop(
  prompt: string,
  adapter: LLMAdapter,
  systemPrompt?: string,
  options: RalphLoopOptions = {},
): Promise<string> {
  const messages: LLMMessage[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const resp = await runWithRalphLoop(
    { messages, timeoutMs: 120_000 },
    adapter,
    { originalGoal: prompt, ...options },
  );
  return resp.content;
}
