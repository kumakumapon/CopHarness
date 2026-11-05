/** Turn stored transcripts and live events into the items the chat view renders. */
import type { AgentEvent, ImagePart, Message, PermissionDecision, PermissionRequest, TurnStopReason } from '../../lib/types';

export type Item =
  | { kind: 'user'; key: string; text: string; images: ImagePart[] }
  | { kind: 'assistant'; key: string; text: string; reasoning?: string; streaming?: boolean; agent?: string }
  | { kind: 'tool'; key: string; id: string; name: string; summary: string; input: Record<string, unknown>; result?: string; isError?: boolean; durationMs?: number; agent?: string }
  | { kind: 'approval'; key: string; request: PermissionRequest; decision?: PermissionDecision; by?: string }
  | { kind: 'notice'; key: string; text: string; tone: 'info' | 'warn' }
  | { kind: 'summary'; key: string; text: string }
  | { kind: 'end'; key: string; stopReason: TurnStopReason; tokens: number; costUsd?: number };

export type TranscriptEntry = Message | { compaction: true; at: string };

const SUMMARY_PREFIX = '[これまでの会話の要約]';

let seq = 0;
const key = (p: string) => `${p}-${++seq}`;

function summarize(input: Record<string, unknown>): string {
  const v = input.command ?? input.path ?? input.url ?? input.pattern ?? input.description ?? input.name;
  if (typeof v === 'string') return v;
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 117)}...` : json;
}

export function itemsFromTranscript(entries: TranscriptEntry[]): Item[] {
  const items: Item[] = [];
  const tools = new Map<string, Extract<Item, { kind: 'tool' }>>();
  for (const entry of entries) {
    if ('compaction' in entry) continue;
    if (entry.role === 'user') {
      const textParts = entry.content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n');
      for (const p of entry.content) {
        if (p.type === 'tool_result') {
          const t = tools.get(p.toolCallId);
          if (t) { t.result = p.content; t.isError = Boolean(p.isError); }
        }
      }
      if (textParts.startsWith(SUMMARY_PREFIX)) items.push({ kind: 'summary', key: key('s'), text: textParts.slice(SUMMARY_PREFIX.length).trim() });
      else if (textParts.trim() || entry.content.some(p => p.type === 'image')) {
        items.push({ kind: 'user', key: key('u'), text: textParts.replace(/\n\n<context>[\s\S]*<\/context>$/, ''), images: entry.content.filter((p): p is ImagePart => p.type === 'image') });
      }
      continue;
    }
    const reasoning = entry.content.filter(p => p.type === 'reasoning').map(p => (p as { text: string }).text).join('\n');
    const text = entry.content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('');
    if (text.trim()) items.push({ kind: 'assistant', key: key('a'), text, reasoning: reasoning || undefined });
    for (const p of entry.content) {
      if (p.type !== 'tool_call') continue;
      const t: Extract<Item, { kind: 'tool' }> = { kind: 'tool', key: key('t'), id: p.id, name: p.name, summary: summarize(p.input), input: p.input };
      tools.set(p.id, t);
      items.push(t);
    }
  }
  return items;
}

/** Apply one live event. Returns a new array (React state). */
export function applyEvent(items: Item[], event: AgentEvent): Item[] {
  const next = [...items];
  const last = next[next.length - 1];
  switch (event.type) {
    case 'text_delta': {
      if (event.agent) return items;
      if (last?.kind === 'assistant' && last.streaming) next[next.length - 1] = { ...last, text: last.text + event.text };
      else next.push({ kind: 'assistant', key: key('a'), text: event.text, streaming: true });
      return next;
    }
    case 'reasoning_delta': {
      if (event.agent) return items;
      if (last?.kind === 'assistant' && last.streaming) next[next.length - 1] = { ...last, reasoning: (last.reasoning ?? '') + event.text };
      else next.push({ kind: 'assistant', key: key('a'), text: '', reasoning: event.text, streaming: true });
      return next;
    }
    case 'message': {
      // The model call finished: stop the streaming bubble so the next delta starts a new one.
      if (last?.kind === 'assistant' && last.streaming) next[next.length - 1] = { ...last, streaming: false };
      return next;
    }
    case 'tool_call': {
      const closed = next.map(i => (i.kind === 'assistant' && i.streaming ? { ...i, streaming: false } : i));
      closed.push({ kind: 'tool', key: key('t'), id: event.id, name: event.name, summary: event.summary, input: event.input, agent: event.agent });
      return closed;
    }
    case 'tool_result':
      return next.map(i => (i.kind === 'tool' && i.id === event.id && i.result === undefined ? { ...i, result: event.content, isError: event.isError, durationMs: event.durationMs } : i));
    case 'permission_request':
      if (next.some(i => i.kind === 'approval' && i.request.id === event.request.id)) return items;
      next.push({ kind: 'approval', key: key('p'), request: event.request });
      return next;
    case 'permission_resolved':
      return next.map(i => (i.kind === 'approval' && i.request.id === event.id ? { ...i, decision: event.decision, by: event.by } : i));
    case 'notice':
      next.push({ kind: 'notice', key: key('n'), text: event.message, tone: 'warn' });
      return next;
    case 'compaction':
      next.push({ kind: 'notice', key: key('n'), text: `会話を要約して圧縮しました（約 ${event.beforeTokens.toLocaleString()} → ${event.afterTokens.toLocaleString()} tokens）`, tone: 'info' });
      return next;
    case 'turn_end': {
      const done = next.map(i => (i.kind === 'assistant' && i.streaming ? { ...i, streaming: false } : i));
      const u = event.usage;
      done.push({ kind: 'end', key: key('e'), stopReason: event.stopReason, tokens: u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens, costUsd: event.costUsd });
      return done;
    }
    default:
      return items;
  }
}
