import { GoogleGenAI, type Content, type Part, type FunctionDeclaration, type GenerateContentResponse } from '@google/genai';
import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import { type SkillDefinition, MAX_SKILL_ITERATIONS } from '../skill';
import { mergeAbortSignals } from '../utils/abort';
import { withContextFallback } from '../utils/contextRetry';

function skillToFunctionDeclaration(skill: SkillDefinition): FunctionDeclaration {
  return {
    name: skill.name,
    description: skill.description,
    parametersJsonSchema: skill.parameters as unknown,
  };
}

function buildContents(messages: LLMRequest['messages'], attachments?: LLMRequest['attachments']): { systemInstruction?: string; contents: Content[] } {
  const systemParts = messages.filter((m) => m.role === 'system');
  const systemInstruction = systemParts.map((m) => m.content).join('\n') || undefined;

  const conversationMessages = messages.filter((m) => m.role !== 'system');
  const contents: Content[] = conversationMessages.map((m, idx) => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const isLastUser = m.role === 'user' && idx === conversationMessages.length - 1;

    if (isLastUser && attachments && attachments.length > 0) {
      const parts: Part[] = [
        { text: m.content },
        ...attachments.map((att) => ({
          inlineData: { data: att.data, mimeType: att.mimeType },
        })),
      ];
      return { role, parts };
    }
    return { role, parts: [{ text: m.content }] };
  });

  return { systemInstruction, contents };
}

export class AntigravityAdapter implements LLMAdapter {
  readonly provider = 'antigravity';
  readonly model: string;
  private readonly client: GoogleGenAI;
  private readonly timeoutMs: number;

  constructor(model: string, apiKey: string, timeoutMs = 30_000) {
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.client = new GoogleGenAI({ apiKey });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return withContextFallback(
      (messages) => this._complete({ ...request, messages }),
      request.messages,
    );
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    const model = request.model ?? this.model;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const skills = request.skills ?? [];

    const { systemInstruction, contents } = buildContents(request.messages, request.attachments);
    const mutableContents: Content[] = [...contents];

    const tools = skills.length > 0
      ? [{ functionDeclarations: skills.map(skillToFunctionDeclaration) }]
      : undefined;
    const skillMap = new Map(skills.map((s) => [s.name, s]));

    for (let iteration = 0; iteration < MAX_SKILL_ITERATIONS; iteration++) {
      const { signal, cleanup } = mergeAbortSignals(timeoutMs, request.abortSignal);
      try {
        const streamResponse = await this.client.models.generateContentStream({
          model,
          contents: mutableContents,
          config: {
            systemInstruction,
            ...(tools ? { tools } : {}),
            abortSignal: signal,
          },
        });

        let hasToolCalls = false;
        const responseParts: Part[] = [];

        for await (const chunk of streamResponse) {
          if (signal.aborted) break;
          const candidate = chunk.candidates?.[0];
          if (!candidate?.content?.parts) continue;

          for (const part of candidate.content.parts) {
            if (part.text) {
              yield part.text;
              responseParts.push({ text: part.text });
            }
            if (part.functionCall) {
              hasToolCalls = true;
              responseParts.push({ functionCall: part.functionCall });
            }
          }
        }

        if (!hasToolCalls) return;

        mutableContents.push({ role: 'model', parts: responseParts });

        const functionCallParts = responseParts.filter((p) => p.functionCall);
        const toolResults = await Promise.allSettled(
          functionCallParts.map(async (part) => {
            const fc = part.functionCall!;
            const skill = skillMap.get(fc.name ?? '');
            if (skill) {
              const args = (fc.args ?? {}) as Record<string, unknown>;
              const result = await skill.handler(args);
              return {
                functionResponse: {
                  name: fc.name ?? '',
                  response: { output: result.content },
                },
              } as Part;
            }
            return {
              functionResponse: {
                name: fc.name ?? '',
                response: { error: `Unknown skill: ${fc.name}` },
              },
            } as Part;
          }),
        );

        const resultParts: Part[] = toolResults.map((r) =>
          r.status === 'fulfilled'
            ? r.value
            : { functionResponse: { name: '', response: { error: `Tool execution failed: ${r.reason}` } } } as Part,
        );
        mutableContents.push({ role: 'user', parts: resultParts });
      } finally {
        cleanup();
      }
    }
  }

  private async _complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.model;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const skills = request.skills ?? [];

    const { systemInstruction, contents } = buildContents(request.messages, request.attachments);
    const mutableContents: Content[] = [...contents];

    const tools = skills.length > 0
      ? [{ functionDeclarations: skills.map(skillToFunctionDeclaration) }]
      : undefined;
    const skillMap = new Map(skills.map((s) => [s.name, s]));

    for (let iteration = 0; iteration < MAX_SKILL_ITERATIONS; iteration++) {
      const { signal, cleanup } = mergeAbortSignals(timeoutMs, request.abortSignal);
      let response: GenerateContentResponse;
      try {
        response = await this.client.models.generateContent({
          model,
          contents: mutableContents,
          config: {
            systemInstruction,
            ...(tools ? { tools } : {}),
            abortSignal: signal,
          },
        });
      } finally {
        cleanup();
      }

      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) break;

      const functionCalls = candidate.content.parts.filter((p) => p.functionCall);

      if (functionCalls.length === 0) {
        const text = response.text ?? '';
        const usage = response.usageMetadata
          ? {
              promptTokens: response.usageMetadata.promptTokenCount,
              completionTokens: response.usageMetadata.candidatesTokenCount,
              totalTokens: response.usageMetadata.totalTokenCount,
            }
          : undefined;
        return { content: text, model, provider: 'antigravity', usage };
      }

      mutableContents.push({ role: 'model', parts: candidate.content.parts });

      const toolResults = await Promise.allSettled(
        functionCalls.map(async (part) => {
          const fc = part.functionCall!;
          const skill = skillMap.get(fc.name ?? '');
          if (skill) {
            const args = (fc.args ?? {}) as Record<string, unknown>;
            const result = await skill.handler(args);
            return {
              functionResponse: {
                name: fc.name ?? '',
                response: { output: result.content },
              },
            } as Part;
          }
          return {
            functionResponse: {
              name: fc.name ?? '',
              response: { error: `Unknown skill: ${fc.name}` },
            },
          } as Part;
        }),
      );

      const resultParts: Part[] = toolResults.map((r) =>
        r.status === 'fulfilled'
          ? r.value
          : { functionResponse: { name: '', response: { error: `Tool execution failed: ${r.reason}` } } } as Part,
      );
      mutableContents.push({ role: 'user', parts: resultParts });
    }

    console.warn('[AntigravityAdapter] MAX_SKILL_ITERATIONS reached without a text response');
    return { content: '', model, provider: 'antigravity' };
  }
}
