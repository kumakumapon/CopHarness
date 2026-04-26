import OpenAI from 'openai';
import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import { mergeAbortSignals } from '../utils/abort';

export class OpenAIAdapter implements LLMAdapter {
  readonly provider = 'openai';
  readonly model: string;
  private readonly client: OpenAI;
  private readonly timeoutMs: number;

  constructor(model: string, apiKey: string, apiBaseUrl?: string, timeoutMs = 30_000) {
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.client = new OpenAI({
      apiKey,
      baseURL: apiBaseUrl,
      timeout: timeoutMs,
    });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.model;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = request.messages.map((m, idx) => {
      const isLastUser = m.role === 'user' && idx === request.messages.length - 1;
      if (isLastUser && request.attachments && request.attachments.length > 0) {
        const content: OpenAI.Chat.ChatCompletionContentPart[] = [
          { type: 'text', text: m.content },
          ...request.attachments.map((att) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${att.mimeType};base64,${att.data}` },
          })),
        ];
        return { role: 'user' as const, content };
      }
      return { role: m.role as 'user' | 'assistant' | 'system', content: m.content };
    });

    const { signal, cleanup } = mergeAbortSignals(timeoutMs, request.abortSignal);
    try {
      const completion = await this.client.chat.completions.create(
        { model, messages },
        { signal },
      );
      const content = completion.choices[0]?.message?.content ?? '';
      return { content, model, provider: 'openai' };
    } finally {
      cleanup();
    }
  }
}
