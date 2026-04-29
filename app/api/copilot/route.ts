import { NextRequest, NextResponse } from 'next/server'
import { createAdapter, resolveProvider } from '../../../lib/adapterFactory';
import { type LLMMessage, type LLMAttachment } from '../../../lib/adapter';
import { resolveSkills } from '../../../lib/skill';
import '../../../lib/skills/index';


export async function POST(req: NextRequest) {
  // プロバイダ自動判定
  const provider = resolveProvider();
  // Copilot, OpenAI, Anthropic などで環境変数名が異なるため柔軟に取得
  const apiKey = process.env.COPILOT_PROVIDER_API_KEY || process.env.COPILOT_API_KEY || process.env.GITHUB_COPILOT_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Missing API key (COPILOT_PROVIDER_API_KEY, OPENAI_API_KEY, etc)' },
      { status: 401 }
    );
  }

  let body: { messages?: LLMMessage[]; attachments?: LLMAttachment[]; timeoutMs?: number; skills?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { messages, attachments } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: 'messages array is required and must not be empty' },
      { status: 400 }
    );
  }

  try {
    // モデル名は環境変数またはデフォルト
    const model = process.env.COPILOT_MODEL || process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || process.env.GEMINI_MODEL || 'gpt-5-mini';
    const defaultTimeout = Number(process.env.COPILOT_TIMEOUT_MS) || 120_000;
    // Cap user-supplied timeoutMs to the server default to prevent resource exhaustion.
    const timeoutMs =
      body.timeoutMs != null
        ? Math.min(Math.max(1, body.timeoutMs), defaultTimeout)
        : defaultTimeout;
    const adapter = createAdapter({
      provider,
      model,
      apiKey,
      timeoutMs,
    });
    const skills = Array.isArray(body.skills) ? resolveSkills(body.skills) : undefined;
    const resp = await adapter.complete({ messages, attachments, timeoutMs, abortSignal: req.signal, skills });
    return NextResponse.json({ reply: resp.content });
  } catch (err: unknown) {
    console.error('LLM API handler error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      message.toLowerCase().includes('timeout') ||
      message.includes('ETIMEDOUT') ||
      message.toLowerCase().includes('timed out');
    const isAuthError =
      message.toLowerCase().includes('failed to obtain copilot session token') ||
      message.includes('401') ||
      message.includes('403');
    if (isTimeout) {
      return NextResponse.json(
        { error: 'LLM API timed out', details: message },
        { status: 504 }
      );
    }
    if (isAuthError) {
      const status = message.includes('403') ? 403 : 401;
      return NextResponse.json(
        { error: 'LLM authentication failed. Check API key or token type.', details: message },
        { status }
      );
    }
    return NextResponse.json(
      { error: 'LLM API error', details: message },
      { status: 502 }
    );
  }
}
