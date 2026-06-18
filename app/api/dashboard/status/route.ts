import { NextRequest, NextResponse } from 'next/server';
import { resolveProvider, resolveModel } from '../../../../lib/adapterFactory';
import { requireApiKey } from '../../../../lib/apiAuth';
import { responseCache, isCacheEnabled } from '../../../../lib/cache/responseCache';

interface ComponentStatus {
  name: string;
  configured: boolean;
  detail?: string;
}

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const provider = resolveProvider();
  const model = resolveModel(provider);

  const providers: ComponentStatus[] = [
    {
      name: 'GitHub Copilot',
      configured: !!(
        process.env.GITHUB_COPILOT_API_KEY ||
        process.env.COPILOT_API_KEY ||
        process.env.COPILOT_PROVIDER_API_KEY
      ),
    },
    {
      name: 'OpenAI',
      configured: !!process.env.OPENAI_API_KEY,
    },
    {
      name: 'Anthropic',
      configured: !!process.env.ANTHROPIC_API_KEY,
    },
    {
      name: 'LM Studio',
      configured: !!process.env.LMSTUDIO_BASE_URL,
      detail: process.env.LMSTUDIO_BASE_URL,
    },
    {
      name: 'Lemonade',
      configured: !!process.env.LEMONADE_BASE_URL,
      detail: process.env.LEMONADE_BASE_URL,
    },
  ];

  const bots: ComponentStatus[] = [
    {
      name: 'Discord Bot',
      configured: !!process.env.DISCORD_BOT_TOKEN,
    },
    {
      name: 'LINE Bot',
      configured: !!(
        process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN
      ),
    },
  ];

  const configuredCount = providers.filter((p) => p.configured).length + bots.filter((b) => b.configured).length;
  const totalCount = providers.length + bots.length;

  const cache = {
    enabled: isCacheEnabled(),
    ...responseCache.getStats(),
  };

  return NextResponse.json({
    activeProvider: provider,
    activeModel: model,
    configuredCount,
    totalCount,
    providers,
    bots,
    cache,
    checkedAt: new Date().toISOString(),
  });
}
