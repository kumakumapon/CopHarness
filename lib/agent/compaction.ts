/**
 * Client-side compaction that replaces the whole history with one summary.
 * The summarization request reuses the session's system prompt and tools and
 * only appends a message, so caches and reasoning signatures stay valid; the
 * new history replays no earlier reasoning.
 */
import type { ModelProvider } from '../providers';
import { messageText, userMessage, type Message, type ToolSpec, type Usage } from '../types';

export const COMPACT_INSTRUCTION = [
  'ここまでの会話を、別の担当者がそのまま作業を引き継げる要約にしてください。',
  '含めるもの: ユーザーの目的と要望、合意・決定した事項、作成・変更したファイルとその内容、ツールの結果から分かった重要な事実、',
  '未完了の作業と次にやること、ユーザーへの未回答の質問。',
  'ツールは呼び出さず、要約の本文だけをテキストで返してください。',
].join('');

export const SUMMARY_PREFIX = '[これまでの会話の要約]';

export function estimateTokens(messages: Message[], system = ''): number {
  let chars = system.length;
  for (const m of messages) {
    for (const p of m.content) {
      if (p.type === 'text' || p.type === 'reasoning') chars += p.text.length;
      else if (p.type === 'tool_call') chars += JSON.stringify(p.input).length + p.name.length;
      else if (p.type === 'tool_result') chars += p.content.length;
      else if (p.type === 'image') chars += 6000;
    }
  }
  return Math.ceil(chars / 3.5);
}

function fallbackSummary(messages: Message[]): string {
  const lines = messages.flatMap(m => m.content.map(p => {
    if (p.type === 'text') return `${m.role}: ${p.text}`;
    if (p.type === 'tool_call') return `tool ${p.name}: ${JSON.stringify(p.input).slice(0, 200)}`;
    if (p.type === 'tool_result') return `result: ${p.content.slice(0, 300)}`;
    return '';
  })).filter(Boolean);
  return lines.join('\n').slice(-8000);
}

export async function compactHistory(options: {
  provider: ModelProvider;
  model: string;
  system: string;
  tools: ToolSpec[];
  messages: Message[];
  signal?: AbortSignal;
}): Promise<{ summary: Message; usage?: Usage }> {
  const request = {
    model: options.model,
    system: options.system,
    tools: options.tools,
    messages: [...options.messages, userMessage(COMPACT_INSTRUCTION)],
    signal: options.signal,
  };
  let text = '';
  let usage: Usage | undefined;
  try {
    if (options.provider.runTurn) {
      const r = await options.provider.runTurn({
        ...request,
        onEvent: () => {},
        executeTool: async call => ({ type: 'tool_result', toolCallId: call.id, name: call.name, content: '要約中はツールを使えません。', isError: true }),
      });
      text = r.text;
      usage = r.usage;
    } else {
      const r = await options.provider.stream(request, () => {});
      text = messageText(r.message);
      usage = r.usage;
    }
  } catch (err) {
    if (options.signal?.aborted) throw err;
    text = '';
  }
  if (!text.trim()) text = fallbackSummary(options.messages);
  return {
    summary: userMessage(`${SUMMARY_PREFIX}\n${text.trim()}\n\n（この要約の続きから会話を再開します）`),
    usage,
  };
}
