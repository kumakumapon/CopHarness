import { GoogleGenAI, type Content, type Part, type GenerateContentResponseUsageMetadata } from '@google/genai';
import type { ContentPart, Message, StopReason } from '../types';
import type { ModelProvider, ModelRequest, ModelResult } from './types';

const AUTO_ID = 'gemini_auto_';
/** Documented placeholder for function calls the model did not produce itself (e.g. after a provider switch). */
const SKIP_SIGNATURE = 'skip_thought_signature_validator';

export interface GeminiOptions {
  apiKey: string;
  /** Alternative endpoint (proxies, tests). */
  baseUrl?: string;
  timeoutMs: number;
  maxOutputTokens?: number;
}

export function toGeminiContents(messages: Message[]): Content[] {
  return messages.map((m): Content => {
    if (m.role === 'assistant') {
      const native = m.native?.provider === 'gemini' ? m.native.content as Part[] : undefined;
      if (native?.length) return { role: 'model', parts: native };
      const parts: Part[] = [];
      for (const p of m.content) {
        if (p.type === 'text' && p.text) parts.push({ text: p.text });
        if (p.type === 'tool_call') {
          parts.push({
            functionCall: { name: p.name, args: p.input, ...(p.id.startsWith(AUTO_ID) ? {} : { id: p.id }) },
            thoughtSignature: SKIP_SIGNATURE,
          });
        }
      }
      return { role: 'model', parts: parts.length ? parts : [{ text: '(empty)' }] };
    }
    const parts: Part[] = [];
    for (const p of m.content) {
      if (p.type === 'text') parts.push({ text: p.text });
      else if (p.type === 'image') parts.push({ inlineData: { data: p.data, mimeType: p.mimeType } });
      else if (p.type === 'tool_result') {
        parts.push({
          functionResponse: {
            name: p.name,
            ...(p.toolCallId.startsWith(AUTO_ID) ? {} : { id: p.toolCallId }),
            response: p.isError ? { error: p.content } : { output: p.content },
          },
        });
      }
    }
    return { role: 'user', parts: parts.length ? parts : [{ text: '(empty)' }] };
  });
}

function mapFinish(reason: string | undefined, hasCalls: boolean): StopReason {
  if (hasCalls) return 'tool_use';
  if (reason === 'MAX_TOKENS') return 'max_tokens';
  if (reason && /SAFETY|RECITATION|PROHIBITED|BLOCKLIST|SPII/.test(reason)) return 'refusal';
  return 'end_turn';
}

export class GeminiProvider implements ModelProvider {
  readonly kind = 'gemini';
  private readonly client: GoogleGenAI;

  constructor(private readonly options: GeminiOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey, httpOptions: { timeout: options.timeoutMs, ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}) } });
  }

  async stream(request: ModelRequest, onEvent: Parameters<ModelProvider['stream']>[1]): Promise<ModelResult> {
    const thinking = /^gemini-(2\.5|[3-9])/.test(request.model);
    const response = await this.client.models.generateContentStream({
      model: request.model,
      contents: toGeminiContents(request.messages),
      config: {
        systemInstruction: request.system || undefined,
        ...(request.tools.length ? {
          tools: [{ functionDeclarations: request.tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }],
        } : {}),
        ...(thinking ? { thinkingConfig: { includeThoughts: true } } : {}),
        ...(this.options.maxOutputTokens ? { maxOutputTokens: this.options.maxOutputTokens } : {}),
        abortSignal: request.signal,
      },
    });

    const nativeParts: Part[] = [];
    const content: ContentPart[] = [];
    let text = '';
    let finish: string | undefined;
    let usage: GenerateContentResponseUsageMetadata | undefined;
    let autoId = 0;

    for await (const chunk of response) {
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finish = candidate.finishReason;
      for (const part of candidate?.content?.parts ?? []) {
        nativeParts.push(part);
        if (part.thought) {
          if (part.text) onEvent({ type: 'reasoning_delta', text: part.text });
          continue;
        }
        if (part.text) {
          text += part.text;
          onEvent({ type: 'text_delta', text: part.text });
        }
        if (part.functionCall) {
          content.push({
            type: 'tool_call',
            id: part.functionCall.id || `${AUTO_ID}${autoId++}`,
            name: part.functionCall.name ?? '',
            input: (part.functionCall.args ?? {}) as Record<string, unknown>,
          });
        }
      }
    }
    if (text) content.unshift({ type: 'text', text });
    const hasCalls = content.some(p => p.type === 'tool_call');
    const cached = usage?.cachedContentTokenCount ?? 0;
    return {
      message: { role: 'assistant', content, native: { provider: 'gemini', content: nativeParts } },
      stopReason: mapFinish(finish, hasCalls),
      usage: {
        inputTokens: Math.max(0, (usage?.promptTokenCount ?? 0) - cached),
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    };
  }
}
