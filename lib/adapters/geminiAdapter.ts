/**
 * Gemini adapter – implements LLMAdapter using GeminiClient.
 * Maps internal LLMRequest/LLMResponse to Gemini REST API payloads.
 */

import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import {
  GeminiClient,
  type GeminiContent,
  type GeminiRequestPayload,
  GEMINI_DEFAULT_ENDPOINT,
  GEMINI_DEFAULT_TIMEOUT_MS,
  GEMINI_DEFAULT_RETRY_MAX,
} from '../services/geminiClient';

/**
 * Maps internal conversation roles to Gemini roles.
 * Only 'user' and 'assistant' (→ 'model') are expected here;
 * 'system' messages are extracted before calling this and sent via systemInstruction.
 */
function mapRoleToGemini(
  role: 'user' | 'assistant' | 'system',
): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user';
}

export class GeminiAdapter implements LLMAdapter {
  readonly provider = 'gemini';
  readonly model: string;
  private readonly client: GeminiClient;

  constructor(
    model: string,
    apiKey: string,
    endpoint: string = GEMINI_DEFAULT_ENDPOINT,
    timeoutMs: number = GEMINI_DEFAULT_TIMEOUT_MS,
    retryMax: number = GEMINI_DEFAULT_RETRY_MAX,
  ) {
    this.model = model;
    this.client = new GeminiClient(apiKey, endpoint, timeoutMs, retryMax);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.model;

    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const conversationMessages = request.messages.filter(
      (m) => m.role !== 'system',
    );

    const contents: GeminiContent[] = conversationMessages.map((m, idx) => {
      const isLastUser = m.role === 'user' && idx === conversationMessages.length - 1;
      const parts: GeminiContent['parts'] = [{ text: m.content }];
      if (isLastUser && request.attachments && request.attachments.length > 0) {
        for (const att of request.attachments) {
          parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
        }
      }
      return { role: mapRoleToGemini(m.role), parts };
    });

    const payload: GeminiRequestPayload = { contents };

    if (systemMessages.length > 0) {
      payload.systemInstruction = {
        parts: [{ text: systemMessages.map((m) => m.content).join('\n') }],
      };
    }

    console.info('[GeminiAdapter] Sending request', { model, provider: 'gemini' });

    const raw = await this.client.request(model, payload, { signal: request.abortSignal });

    const content =
      raw.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';

    return { content, model, provider: 'gemini' };
  }
}
