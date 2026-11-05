import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolUnion,
  MessageCreateParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Effort } from '../config';
import type { ContentPart, Message, StopReason } from '../types';
import type { ModelProvider, ModelRequest, ModelResult } from './types';

/** Models that run adaptive thinking and accept `output_config.effort`. */
export function supportsAdaptiveThinking(model: string): boolean {
  return /^claude-(fable|mythos)-/.test(model)
    || /^claude-(opus|sonnet|haiku)-5/.test(model)
    || /^claude-(opus|sonnet)-4-[6-9]/.test(model);
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const SERVER_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
  maxOutputTokens?: number;
  effort?: Effort;
}

function toBlocks(parts: ContentPart[]): BetaContentBlockParam[] {
  const blocks: BetaContentBlockParam[] = [];
  for (const part of parts) {
    switch (part.type) {
      case 'text':
        if (part.text) blocks.push({ type: 'text', text: part.text });
        break;
      case 'image':
        blocks.push({ type: 'image', source: { type: 'base64', media_type: part.mimeType as 'image/png', data: part.data } });
        break;
      case 'tool_call':
        blocks.push({ type: 'tool_use', id: part.id, name: part.name, input: part.input });
        break;
      case 'tool_result':
        blocks.push({ type: 'tool_result', tool_use_id: part.toolCallId, content: part.content, ...(part.isError ? { is_error: true } : {}) });
        break;
      case 'reasoning':
        break; // reasoning from other providers cannot be replayed
    }
  }
  return blocks.length ? blocks : [{ type: 'text', text: '(empty)' }];
}

export function toAnthropicMessages(messages: Message[]): BetaMessageParam[] {
  return messages.map(m => {
    if (m.role === 'assistant' && m.native?.provider === 'anthropic') {
      // Replay exactly what the API returned: thinking signatures stay valid and the cache prefix is stable.
      return { role: 'assistant', content: m.native.content as BetaContentBlockParam[] };
    }
    return { role: m.role, content: toBlocks(m.content) };
  });
}

function fromBlocks(blocks: BetaContentBlock[]): ContentPart[] {
  const parts: ContentPart[] = [];
  for (const block of blocks) {
    if (block.type === 'text') parts.push({ type: 'text', text: block.text });
    else if (block.type === 'tool_use') parts.push({ type: 'tool_call', id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    else if (block.type === 'thinking' && block.thinking) parts.push({ type: 'reasoning', text: block.thinking });
  }
  return parts;
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'tool_use': return 'tool_use';
    case 'max_tokens':
    case 'model_context_window_exceeded': return 'max_tokens';
    case 'refusal': return 'refusal';
    case 'pause_turn': return 'pause_turn';
    default: return 'end_turn';
  }
}

export class AnthropicProvider implements ModelProvider {
  readonly kind = 'anthropic';
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      maxRetries: 3,
    });
  }

  buildParams(request: ModelRequest): MessageCreateParams & { stream?: boolean } {
    const adaptive = supportsAdaptiveThinking(request.model);
    const tools: BetaToolUnion[] = request.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as { type: 'object' },
      // Large inputs (file contents) stream as they are generated; the agent loop validates every input.
      eager_input_streaming: true,
    }));
    const useFallback = !this.options.baseUrl && SERVER_FALLBACK_MODELS.has(request.model);
    return {
      model: request.model,
      max_tokens: this.options.maxOutputTokens ?? (adaptive ? 64_000 : 16_000),
      system: request.system ? [{ type: 'text', text: request.system }] : undefined,
      messages: toAnthropicMessages(request.messages),
      ...(tools.length ? { tools } : {}),
      // Automatic prompt caching of the stable prefix (tools → system → history).
      cache_control: { type: 'ephemeral' },
      ...(adaptive ? {
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: this.options.effort ?? 'high' },
      } : {}),
      ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    } as MessageCreateParams;
  }

  async stream(request: ModelRequest, onEvent: Parameters<ModelProvider['stream']>[1]): Promise<ModelResult> {
    const params = this.buildParams(request);
    for (let attempt = 0; ; attempt++) {
      const stream = this.client.beta.messages.stream(params, { signal: request.signal });
      stream.on('text', text => onEvent({ type: 'text_delta', text }));
      stream.on('thinking', text => onEvent({ type: 'reasoning_delta', text }));
      try {
        const final = await stream.finalMessage();
        const usage = final.usage;
        return {
          message: {
            role: 'assistant',
            content: fromBlocks(final.content),
            native: { provider: 'anthropic', content: final.content },
          },
          stopReason: mapStopReason(final.stop_reason),
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          },
        };
      } catch (err) {
        // With eager input streaming an unparseable tool input rejects the final message;
        // re-issue the turn (typed API errors are not retried here).
        if (err instanceof Anthropic.APIError || request.signal?.aborted || attempt >= 2) throw err;
        if (!(err instanceof SyntaxError) && !/JSON/i.test(String((err as Error)?.message))) throw err;
      }
    }
  }
}
