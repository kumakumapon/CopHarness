import { NextRequest, NextResponse } from 'next/server';
import { createAdapter, resolveProvider } from '../../../../lib/adapterFactory';
import { type LLMMessage } from '../../../../lib/adapter';
import {
  getTemplateById,
  buildWizardSystemPrompt,
  promptTemplates,
} from '../../../../lib/promptTemplates';

export async function GET() {
  const list = promptTemplates.map(({ id, nameJa, descriptionJa, category, icon }) => ({
    id,
    nameJa,
    descriptionJa,
    category,
    icon,
  }));
  return NextResponse.json({ templates: list });
}

export async function POST(req: NextRequest) {
  let body: {
    patternId: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { patternId, messages } = body;
  if (!patternId || !Array.isArray(messages)) {
    return NextResponse.json(
      { error: 'patternId and messages are required' },
      { status: 400 },
    );
  }

  const template = getTemplateById(patternId);
  if (!template) {
    return NextResponse.json({ error: `Unknown template: ${patternId}` }, { status: 404 });
  }

  const provider = resolveProvider();
  const localProviders = ['lmstudio', 'lemonade'];
  const apiKey =
    process.env.COPILOT_PROVIDER_API_KEY ??
    process.env.COPILOT_API_KEY ??
    process.env.GITHUB_COPILOT_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.GEMINI_API_KEY;

  if (!apiKey && !localProviders.includes(provider)) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
  }

  const systemPrompt = buildWizardSystemPrompt(template);
  const llmMessages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  try {
    const model =
      process.env.COPILOT_MODEL ??
      process.env.OPENAI_MODEL ??
      process.env.ANTHROPIC_MODEL ??
      process.env.GEMINI_MODEL ??
      process.env.LMSTUDIO_MODEL ??
      process.env.LEMONADE_MODEL ??
      'gpt-5-mini';
    const adapter = createAdapter({ provider, model, apiKey, timeoutMs: 60_000 });
    const resp = await adapter.complete({ messages: llmMessages });
    const reply = resp.content;

    const collectedMatch = reply.match(/<COLLECTED>([\s\S]*?)<\/COLLECTED>/);
    if (collectedMatch) {
      try {
        const values = JSON.parse(collectedMatch[1].trim()) as Record<string, string>;
        const generatedPrompt = template.buildPrompt(values);
        return NextResponse.json({
          reply,
          isComplete: true,
          generatedPrompt,
          collectedValues: values,
        });
      } catch {
        // JSON parse failed – treat as incomplete
      }
    }

    return NextResponse.json({ reply, isComplete: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'LLM API error', details: message }, { status: 502 });
  }
}
