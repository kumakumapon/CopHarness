import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { checkAllProviders } from '../../../../lib/adapters/healthCheck';
import { type ProviderType } from '../../../../lib/adapter';

const VALID_PROVIDERS: ProviderType[] = [
  'openai',
  'anthropic',
  'copilot',
  'lmstudio',
  'lemonade',
  'antigravity',
];

function isProviderType(value: unknown): value is ProviderType {
  return typeof value === 'string' && (VALID_PROVIDERS as string[]).includes(value);
}

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const checkedAt = new Date().toISOString();
  const results = await checkAllProviders();

  const healthy = results.filter((r) => r.healthy).length;
  const unhealthy = results.length - healthy;

  return NextResponse.json({
    results,
    summary: {
      total: results.length,
      healthy,
      unhealthy,
    },
    checkedAt,
  });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('providers' in body) ||
    !Array.isArray((body as Record<string, unknown>).providers)
  ) {
    return NextResponse.json(
      { error: 'Request body must include a "providers" array' },
      { status: 400 },
    );
  }

  const rawProviders = (body as Record<string, unknown[]>).providers;
  const providers = rawProviders.filter(isProviderType);

  if (providers.length === 0) {
    return NextResponse.json(
      { error: `No valid providers specified. Valid values: ${VALID_PROVIDERS.join(', ')}` },
      { status: 400 },
    );
  }

  const checkedAt = new Date().toISOString();
  const results = await checkAllProviders({ providers });

  const healthy = results.filter((r) => r.healthy).length;
  const unhealthy = results.length - healthy;

  return NextResponse.json({
    results,
    summary: {
      total: results.length,
      healthy,
      unhealthy,
    },
    checkedAt,
  });
}
