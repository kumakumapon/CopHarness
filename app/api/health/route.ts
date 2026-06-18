import { NextResponse } from 'next/server';
import { resolveProvider, resolveModel } from '../../../lib/adapterFactory';

const startedAt = Date.now();

export async function GET() {
  const provider = resolveProvider();
  const model = resolveModel(provider);

  const memUsage = process.memoryUsage();

  const providerStatus: Record<string, boolean> = {
    copilot: Boolean(process.env.GITHUB_COPILOT_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    lmstudio: Boolean(process.env.LMSTUDIO_BASE_URL),
    lemonade: Boolean(process.env.LEMONADE_BASE_URL),
  };

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.floor((Date.now() - startedAt) / 1000),
      startedAt: new Date(startedAt).toISOString(),
    },
    provider: {
      active: provider,
      model,
      configured: providerStatus,
    },
    memory: {
      rss: memUsage.rss,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  });
}
