import { type LLMAdapter, type LLMRequest, type LLMResponse } from '../adapter';
import { createSession } from '../initCopilot';

export class CopilotAdapter implements LLMAdapter {
  readonly provider = 'copilot';
  readonly model: string;
  private readonly timeoutMs: number;

  constructor(model: string, timeoutMs = 30_000) {
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.model;
    const timeout = request.timeoutMs ?? this.timeoutMs;
    const prompt = request.messages
      .map((m) => {
        if (m.role === 'system') return `System: ${m.content}`;
        if (m.role === 'user') return `User: ${m.content}`;
        return `Assistant: ${m.content}`;
      })
      .join('\n\n');
    const session = await createSession({ model, streaming: false });
    try {
      const sendPromise = session.sendAndWait(
        {
          prompt,
          attachments: request.attachments as any,
        },
        timeout,
      );

      let resp: any;
      const abortSignal = request.abortSignal;
      if (abortSignal) {
        const abortPromise = new Promise<never>((_, reject) => {
          const makeAbortError = () =>
            Object.assign(new Error('Request aborted by client'), { name: 'AbortError' });

          if (abortSignal.aborted) {
            session.destroy().catch(() => {});
            reject(makeAbortError());
            return;
          }
          abortSignal.addEventListener(
            'abort',
            () => {
              session.destroy().catch(() => {});
              console.info('[CopilotAdapter] Request aborted by client');
              reject(makeAbortError());
            },
            { once: true },
          );
        });
        resp = await Promise.race([sendPromise, abortPromise]);
      } else {
        resp = await sendPromise;
      }

      const content = (resp && (resp as any).data && (resp as any).data.content) || '';
      return { content, model, provider: 'copilot' };
    } finally {
      await session.destroy().catch(() => {});
    }
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    const resp = await this.complete(request);
    yield resp.content;
  }
}
