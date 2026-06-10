/**
 * Context Compactor — prevents Context Rot in long-running agent sessions.
 *
 * When a conversation grows beyond a token budget, the compactor:
 * 1. Keeps the last few messages intact (recent context).
 * 2. Uses the LLM to generate a concise summary of older exchanges.
 * 3. Returns a compressed message list: [system] + [summary] + [recent].
 *
 * This preserves overall intent while freeing context headroom for the agent
 * to continue rather than stalling due to context anxiety.
 */

import type { LLMAdapter, LLMMessage } from '../adapter';
import { estimateTokens, estimateMessageTokens } from '../history/trimmer';

/** Token budget below which compaction is skipped. Adjust via COMPACTOR_TOKEN_THRESHOLD. */
const DEFAULT_TOKEN_THRESHOLD = 3_000;

/** Number of recent (non-system) messages to always preserve verbatim. */
const DEFAULT_KEEP_RECENT = 4;

/** Estimate total tokens used by a message list (non-system messages only). */
export function estimateConversationTokens(messages: LLMMessage[]): number {
  return messages
    .filter((m) => m.role !== 'system')
    .reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

/**
 * Compress old messages by summarising them with the provided adapter.
 *
 * @param messages       - Current conversation history (modified in-place is NOT done; a new array is returned).
 * @param adapter        - LLM adapter used to generate the summary.
 * @param keepRecent     - Number of tail (non-system) messages to keep verbatim.
 * @returns              - Compacted message list, or the original if compaction wasn't needed / failed.
 */
export async function compactMessages(
  messages: LLMMessage[],
  adapter: LLMAdapter,
  keepRecent: number = DEFAULT_KEEP_RECENT,
): Promise<LLMMessage[]> {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');

  if (nonSystem.length <= keepRecent) return messages;

  const toSummarise = nonSystem.slice(0, nonSystem.length - keepRecent);
  const recentTail = nonSystem.slice(nonSystem.length - keepRecent);

  // Build a compact transcript for the summarisation prompt
  const transcript = toSummarise
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 1_000)}`)
    .join('\n\n');

  const summaryPrompt: LLMMessage[] = [
    {
      role: 'system',
      content:
        'You are a summarisation assistant. Produce a concise factual summary of the following ' +
        'conversation fragment. Preserve: decisions made, key facts discovered, tasks completed or ' +
        'in-progress, and any outstanding action items. Be brief (≤ 300 words). Output only the summary.',
    },
    { role: 'user', content: transcript },
  ];

  try {
    const resp = await adapter.complete({ messages: summaryPrompt, timeoutMs: 30_000 });
    const summaryContent =
      `[CONTEXT SUMMARY — earlier conversation condensed]\n${resp.content}\n[END SUMMARY]`;

    return [
      ...systemMessages,
      { role: 'assistant', content: summaryContent },
      ...recentTail,
    ];
  } catch {
    // If summarisation fails, fall back to the original messages
    return messages;
  }
}

/**
 * Return true when the conversation exceeds the compaction threshold.
 * Uses the COMPACTOR_TOKEN_THRESHOLD env var if set.
 */
export function needsCompaction(messages: LLMMessage[]): boolean {
  const threshold =
    Number(process.env.COMPACTOR_TOKEN_THRESHOLD) || DEFAULT_TOKEN_THRESHOLD;
  return estimateConversationTokens(messages) > threshold;
}

/**
 * Write a minimal progress artefact to the workspace.
 * This externalises task state so it survives context resets.
 *
 * Writes both progress.md and progress.json.
 * The workspace directory defaults to ./workspace but may be overridden via WORKSPACE_DIR.
 */
export async function writeProgressArtifact(goal: string, summary: string, taskId?: string): Promise<void> {
  try {
    const { promises: fsp } = await import('fs');
    const path = await import('path');
    const dir = process.env.WORKSPACE_DIR
      ? path.resolve(process.env.WORKSPACE_DIR)
      : path.resolve('./workspace');
    await fsp.mkdir(dir, { recursive: true });
    const updatedAt = new Date().toISOString();
    const content = [
      `# Task Progress`,
      `**Goal:** ${goal}`,
      ``,
      `## Summary`,
      summary,
      ``,
      `_Updated: ${updatedAt}_`,
    ].join('\n');
    await fsp.writeFile(path.join(dir, 'progress.md'), content, 'utf-8');
    const jsonPayload: Record<string, unknown> = { goal, summary, updatedAt };
    if (taskId !== undefined) jsonPayload.taskId = taskId;
    await fsp.writeFile(path.join(dir, 'progress.json'), JSON.stringify(jsonPayload, null, 2) + '\n', 'utf-8');
  } catch {
    // Non-critical
  }
}

export { estimateTokens };
