import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import { mergeAbortSignals } from '../utils/abort';

export class AnthropicAdapter implements LLMAdapter {
  readonly provider = 'anthropic';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(model: string, apiKey: string, baseUrl = 'https://api.anthropic.com', timeoutMs = 30_000) {
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.model;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n');
    const conversationMessages = request.messages.filter((m) => m.role !== 'system');
    const messages = conversationMessages.map((m, idx) => {
      const isLastUser = m.role === 'user' && idx === conversationMessages.length - 1;
      if (isLastUser && request.attachments && request.attachments.length > 0) {
        const content: unknown[] = [{ type: 'text', text: m.content }];
        for (const att of request.attachments) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: att.mimeType, data: att.data },
          });
        }
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content };
    });
    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      messages,
    };
    if (systemPrompt) body.system = systemPrompt;

    const { signal, cleanup } = mergeAbortSignals(timeoutMs, request.abortSignal);
    try {
      const resp = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        const err = Object.assign(new Error(`Anthropic API error: ${text}`), { status: resp.status });
        throw err;
      }
      const data = (await resp.json()) as { content: Array<{ type: string; text?: string }> };
      const content = data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      return { content, model, provider: 'anthropic' };
    } finally {
      cleanup();
    }
  }
}
