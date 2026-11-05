import OpenAI from 'openai';
import type { ContentPart, Message, StopReason, ToolCallPart } from '../types';
import type { ModelProvider, ModelRequest, ModelResult } from './types';

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

export interface OpenAIOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
  maxOutputTokens?: number;
  /** Ask the server for usage in the final stream chunk (not every compatible server supports it). */
  streamUsage?: boolean;
}

export function toOpenAIMessages(system: string, messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('');
      const calls = m.content.filter((p): p is ToolCallPart => p.type === 'tool_call');
      out.push({
        role: 'assistant',
        content: text || (calls.length ? null : ''),
        ...(calls.length ? {
          tool_calls: calls.map(c => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })),
        } : {}),
      });
      continue;
    }
    // Tool results become `tool` messages; any remaining text/images form a user message.
    const rest: ContentPart[] = [];
    for (const part of m.content) {
      if (part.type === 'tool_result') out.push({ role: 'tool', tool_call_id: part.toolCallId, content: part.content });
      else rest.push(part);
    }
    const hasImages = rest.some(p => p.type === 'image');
    const text = rest.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n');
    if (!rest.length) continue;
    if (!hasImages) {
      out.push({ role: 'user', content: text });
    } else {
      out.push({
        role: 'user',
        content: rest.flatMap((p): OpenAI.Chat.ChatCompletionContentPart[] => {
          if (p.type === 'text') return [{ type: 'text', text: p.text }];
          if (p.type === 'image') return [{ type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } }];
          return [];
        }),
      });
    }
  }
  return out;
}

function mapFinish(reason: string | null | undefined, hasCalls: boolean): StopReason {
  if (hasCalls) return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return 'end_turn';
}

export class OpenAIProvider implements ModelProvider {
  readonly kind = 'openai';
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAIOptions) {
    this.client = new OpenAI({
      // Local servers (LM Studio, Ollama, ...) ignore the key but the SDK requires one.
      apiKey: options.apiKey || 'not-needed',
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      maxRetries: 3,
    });
  }

  async stream(request: ModelRequest, onEvent: Parameters<ModelProvider['stream']>[1]): Promise<ModelResult> {
    const tools = request.tools.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema as Record<string, unknown> },
    }));
    const official = !this.options.baseUrl;
    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: toOpenAIMessages(request.system, request.messages),
      stream: true,
      ...(this.options.streamUsage ?? official ? { stream_options: { include_usage: true } } : {}),
      ...(tools.length ? { tools } : {}),
      ...(this.options.maxOutputTokens
        ? official ? { max_completion_tokens: this.options.maxOutputTokens } : { max_tokens: this.options.maxOutputTokens }
        : {}),
    }, { signal: request.signal });

    let text = '';
    let finish: string | null | undefined;
    const calls: Record<number, { id: string; name: string; args: string }> = {};
    let usage: OpenAI.CompletionUsage | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta as typeof choice.delta & { reasoning_content?: string; reasoning?: string };
      if (!delta) continue;
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) onEvent({ type: 'reasoning_delta', text: reasoning });
      if (delta.content) {
        text += delta.content;
        onEvent({ type: 'text_delta', text: delta.content });
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index ?? 0] ??= { id: '', name: '', args: '' });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
    }

    const content: ContentPart[] = [];
    if (text) content.push({ type: 'text', text });
    for (const [index, call] of Object.entries(calls)) {
      let input: Record<string, unknown>;
      try {
        input = call.args.trim() ? JSON.parse(call.args) : {};
      } catch {
        // Surface the raw arguments; the loop reports the invalid input back to the model.
        input = { __invalid_json__: call.args };
      }
      content.push({ type: 'tool_call', id: call.id || `call_${index}`, name: call.name, input });
    }
    const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      message: { role: 'assistant', content },
      stopReason: mapFinish(finish, Object.keys(calls).length > 0),
      usage: {
        inputTokens: Math.max(0, (usage?.prompt_tokens ?? 0) - cached),
        outputTokens: usage?.completion_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    };
  }
}
