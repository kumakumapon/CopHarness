import { NextRequest, NextResponse } from 'next/server';
import { getRecentSpans } from '../../../../lib/core/events/tracer';
import { requireApiKey } from '../../../../lib/core/apiAuth';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
  const spans = getRecentSpans(limit);
  return NextResponse.json({ spans, total: spans.length });
}
