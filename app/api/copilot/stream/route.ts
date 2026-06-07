import { NextRequest } from 'next/server';
import { createAdapter, resolveProvider, resolveModel } from '../../../../lib/adapterFactory';
import { type LLMMessage, type LLMAttachment } from '../../../../lib/adapter';
import { resolveSkills, listActiveSkills } from '../../../../lib/skill';
import { requireApiKey } from '../../../../lib/apiAuth';
import '../../../../lib/skills/index';

export async function POST(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const provider = resolveProvider();
  const localProviders = ['lmstudio', 'lemonade'];
  const apiKey =
    process.env.COPILOT_PROVIDER_API_KEY ||
    process.env.COPILOT_API_KEY ||
    process.env.GITHUB_COPILOT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GEMINI_API_KEY;
  if (!apiKey && !localProviders.includes(provider)) {
    return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 401 });
  }

  let body: {
    messages?: LLMMessage[];
    attachments?: LLMAttachment[];
    timeoutMs?: number;
    skills?: string[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { messages, attachments } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages array is required' }), {
      status: 400,
    });
  }

  const model = resolveModel(provider);
  const defaultTimeout = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
  const timeoutMs =
    body.timeoutMs != null
      ? Math.min(Math.max(1, body.timeoutMs), defaultTimeout)
      : defaultTimeout;

  const adapter = createAdapter({ provider, model, apiKey, timeoutMs });
  const skills = Array.isArray(body.skills) ? resolveSkills(body.skills) : listActiveSkills();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const gen = adapter.stream
          ? adapter.stream({ messages, attachments, timeoutMs, abortSignal: req.signal, skills })
          : (async function* fallback() {
              const resp = await adapter.complete({
                messages,
                attachments,
                timeoutMs,
                abortSignal: req.signal,
                skills,
              });
              yield resp.content;
            })();

        for await (const chunk of gen) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`),
          );
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
