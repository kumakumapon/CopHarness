import { runPrompt } from '../scheduler/engine';
import { markWatcherTriggered, getWatcher, listWatchers } from './store';
import type { WatcherDefinition, WatcherEvent } from './types';

export type WatcherPromptRunner = (
  prompt: string,
  abortSignal: AbortSignal | undefined,
  context: {
    watcher: Pick<WatcherDefinition, 'id' | 'name' | 'type' | 'discordChannelId' | 'lineUserId'>;
    reason: string;
    event: WatcherEvent;
  },
) => Promise<string>;

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function payloadRecord(event: WatcherEvent): Record<string, unknown> {
  return typeof event.payload === 'object' && event.payload !== null && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
}

function metadataStringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  return [];
}

function watcherMatchesMetadataFilters(watcher: WatcherDefinition, event: WatcherEvent): boolean {
  const metadata = watcher.metadata ?? {};
  const payload = payloadRecord(event);
  const eventTypes = metadataStringList(metadata.eventTypes ?? metadata.githubEventTypes);
  if (eventTypes.length && !eventTypes.includes(String(event.type ?? ''))) return false;
  const labels = metadataStringList(metadata.labels ?? metadata.githubLabels);
  if (labels.length) {
    const eventLabels = metadataStringList(payload.labels);
    if (!labels.some((label) => eventLabels.includes(label))) return false;
  }
  const authors = metadataStringList(metadata.authors ?? metadata.githubAuthors);
  if (authors.length && !authors.includes(String(payload.author ?? payload.sender ?? ''))) return false;
  const branches = metadataStringList(metadata.branches ?? metadata.githubBranches);
  if (branches.length && !branches.includes(String(payload.branch ?? payload.baseBranch ?? ''))) return false;
  return true;
}

export function buildWatcherPrompt(watcher: WatcherDefinition, event: WatcherEvent): string {
  const receivedAt = event.receivedAt ?? new Date().toISOString();
  return `${watcher.prompt}

Watcher event:
${stableStringify({ ...event, receivedAt })}`;
}

export function watcherMatchesEvent(
  watcher: WatcherDefinition,
  event: WatcherEvent,
  options: { manualOverride?: boolean } = {},
): boolean {
  if (options.manualOverride && event.type === 'manual') return true;
  if (watcher.type !== 'manual' && event.source !== watcher.type) return false;
  if (!watcherMatchesMetadataFilters(watcher, event)) return false;

  const pattern = watcher.eventPattern?.trim();
  if (!pattern) return true;
  const haystack = [
    event.source,
    event.type,
    event.subject,
    typeof event.payload === 'string' ? event.payload : stableStringify(event.payload),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return haystack.includes(pattern.toLowerCase());
}

export function findMatchingWatchers(event: WatcherEvent): WatcherDefinition[] {
  return listWatchers().filter((watcher) => watcher.enabled && watcherMatchesEvent(watcher, event));
}

export async function triggerWatcher(
  id: string,
  event: WatcherEvent,
  options: {
    abortSignal?: AbortSignal;
    runner?: WatcherPromptRunner;
  } = {},
): Promise<{ ok: true; result: string; watcher: WatcherDefinition } | { ok: false; reason: 'not_found' | 'disabled' | 'event_not_matched' }> {
  const watcher = getWatcher(id);
  if (!watcher) return { ok: false, reason: 'not_found' };
  if (!watcher.enabled) return { ok: false, reason: 'disabled' };
  if (!watcherMatchesEvent(watcher, event, { manualOverride: true })) return { ok: false, reason: 'event_not_matched' };

  const triggered = markWatcherTriggered(watcher.id) ?? watcher;
  const prompt = buildWatcherPrompt(triggered, event);
  const runner = options.runner ?? runPrompt;
  const result = await runner(prompt, options.abortSignal, {
    watcher: triggered,
    reason: `watcher:${event.source}`,
    event: { ...event, receivedAt: event.receivedAt ?? new Date().toISOString() },
  });
  return { ok: true, result, watcher: triggered };
}

export async function dispatchWatcherEvent(
  event: WatcherEvent,
  options: {
    abortSignal?: AbortSignal;
    runner?: WatcherPromptRunner;
  } = {},
): Promise<{
  event: WatcherEvent;
  matched: number;
  results: Array<
    | { ok: true; watcher: WatcherDefinition; result: string }
    | { ok: false; watcher: WatcherDefinition; error: string }
  >;
}> {
  const normalizedEvent = {
    ...event,
    receivedAt: event.receivedAt ?? new Date().toISOString(),
  };
  const watchers = findMatchingWatchers(normalizedEvent);
  const settled = await Promise.allSettled(
    watchers.map(async (watcher) => {
      const result = await triggerWatcher(watcher.id, normalizedEvent, options);
      if (!result.ok) {
        throw new Error(result.reason);
      }
      return result;
    }),
  );

  return {
    event: normalizedEvent,
    matched: watchers.length,
    results: settled.map((entry, index) => {
      const watcher = watchers[index];
      if (entry.status === 'fulfilled') {
        return { ok: true, watcher: entry.value.watcher, result: entry.value.result };
      }
      const reason = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
      return { ok: false, watcher, error: reason };
    }),
  };
}
