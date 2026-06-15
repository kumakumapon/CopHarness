/**
 * Gemini adapter – implements LLMAdapter using GeminiClient.
 * Maps internal LLMRequest/LLMResponse to Gemini REST API payloads.
 */

import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import { type SkillDefinition, MAX_SKILL_ITERATIONS } from '../skill';
import {
  GeminiClient,
  type GeminiContent,
  type GeminiPart,
  type GeminiRequestPayload,
  GEMINI_DEFAULT_ENDPOINT,
  GEMINI_DEFAULT_TIMEOUT_MS,
  GEMINI_DEFAULT_RETRY_MAX,
} from '../services/geminiClient';
import { withContextFallback } from '../utils/contextRetry';

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
    return withContextFallback(
      (messages) => this._complete({ ...request, messages }),
      request.messages,
    );
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    const model = request.model ?? this.model;
    const skills = request.skills ?? [];

    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const conversationMessages = request.messages.filter((m) => m.role !== 'system');

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

    const skillMap = new Map(skills.map((s) => [s.name, s]));

    for (let iteration = 0; iteration < MAX_SKILL_ITERATIONS; iteration++) {
      const payload: GeminiRequestPayload = { contents: [...contents] };
      if (systemMessages.length > 0) {
        payload.systemInstruction = {
          parts: [{ text: systemMessages.map((m) => m.content).join('\n') }],
        };
      }
      if (skills.length > 0) {
        payload.tools = [
          {
            functionDeclarations: skills.map((s) => ({
              name: s.name,
              description: s.description,
              parameters: s.parameters as unknown as Record<string, unknown>,
            })),
          },
        ];
      }

      const allParts: GeminiPart[] = [];

      for await (const chunk of this.client.streamRequest(model, payload, {
        signal: request.abortSignal,
      })) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if ('text' in part && part.text) {
            yield part.text;
            allParts.push(part);
          } else if ('functionCall' in part && part.functionCall) {
            allParts.push(part);
          }
        }
      }

      const functionCallParts = allParts.filter(
        (p): p is Extract<GeminiPart, { functionCall: unknown }> =>
          'functionCall' in p && p.functionCall != null,
      );
      if (functionCallParts.length === 0) return;

      contents.push({ role: 'model', parts: allParts as GeminiContent['parts'] });

      const streamGeminiSettled = await Promise.allSettled(
        functionCallParts.map(async (part) => {
          const { name, args } = part.functionCall;
          const skill = skillMap.get(name);
          if (skill) {
            const result = await skill.handler(args);
            return { functionResponse: { name, response: { content: result.content, ...(result.isError ? { isError: true } : {}) } } } as GeminiPart;
          }
          return { functionResponse: { name, response: { error: `Unknown skill: ${name}` } } } as GeminiPart;
        }),
      );
      const responseParts: GeminiPart[] = streamGeminiSettled.map((r) =>
        r.status === 'fulfilled'
          ? r.value
          : { functionResponse: { name: 'unknown', response: { error: `Tool execution failed: ${r.reason}` } } } as GeminiPart,
      );
      contents.push({ role: 'user', parts: responseParts });
    }
  }

  private async _complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.model;
    const skills = request.skills ?? [];

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

    const skillMap = new Map(skills.map((s) => [s.name, s]));

    console.info('[GeminiAdapter] Sending request', { model, provider: 'gemini' });

    for (let iteration = 0; iteration < MAX_SKILL_ITERATIONS; iteration++) {
      const payload: GeminiRequestPayload = { contents: [...contents] };

      if (systemMessages.length > 0) {
        payload.systemInstruction = {
          parts: [{ text: systemMessages.map((m) => m.content).join('\n') }],
        };
      }

      if (skills.length > 0) {
        payload.tools = [
          {
            functionDeclarations: skills.map((s: SkillDefinition) => ({
              name: s.name,
              description: s.description,
              parameters: s.parameters as unknown as Record<string, unknown>,
            })),
          },
        ];
      }

      const raw = await this.client.request(model, payload, { signal: request.abortSignal });

      const candidate = raw.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      const functionCallParts = parts.filter(
        (p): p is Extract<GeminiPart, { functionCall: unknown }> =>
          'functionCall' in p && p.functionCall != null,
      );

      // No function calls – return the text response
      if (functionCallParts.length === 0) {
        const content = parts
          .filter((p): p is Extract<GeminiPart, { text: string }> => 'text' in p && p.text != null)
          .map((p) => p.text)
          .join('');
        const usage = raw.usageMetadata
          ? {
              promptTokens: raw.usageMetadata.promptTokenCount,
              completionTokens: raw.usageMetadata.candidatesTokenCount,
              totalTokens: raw.usageMetadata.totalTokenCount,
            }
          : undefined;
        return { content, model, provider: 'gemini', usage };
      }

      // Append the model's function-call turn
      contents.push({
        role: 'model',
        parts: parts as GeminiContent['parts'],
      });

      // Execute function calls in parallel for better performance
      const geminiToolSettled = await Promise.allSettled(
        functionCallParts.map(async (part) => {
          const { name, args } = part.functionCall;
          const skill = skillMap.get(name);
          if (skill) {
            const result = await skill.handler(args);
            return { functionResponse: { name, response: { content: result.content, ...(result.isError ? { isError: true } : {}) } } } as GeminiPart;
          }
          return { functionResponse: { name, response: { error: `Unknown skill: ${name}` } } } as GeminiPart;
        }),
      );
      const responseParts: GeminiPart[] = geminiToolSettled.map((r) =>
        r.status === 'fulfilled'
          ? r.value
          : { functionResponse: { name: 'unknown', response: { error: `Tool execution failed: ${r.reason}` } } } as GeminiPart,
      );
      contents.push({ role: 'user', parts: responseParts });
    }

    // Fallback: return empty content if loop exhausted without a text response
    console.warn('[GeminiAdapter] MAX_SKILL_ITERATIONS reached without a text response');
    return { content: '', model, provider: 'gemini' };
  }
}
