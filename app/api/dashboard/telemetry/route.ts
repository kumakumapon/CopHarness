import { NextRequest, NextResponse } from 'next/server';
import { getRecentSpans } from '../../../../lib/telemetry/tracer';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
  const spans = getRecentSpans(limit);
  return NextResponse.json({ spans, total: spans.length });
}
