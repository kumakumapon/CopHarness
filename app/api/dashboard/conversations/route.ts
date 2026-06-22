import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { listHistoryKeys } from '../../../../lib/history/store';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 1000) : 100;

  const conversations = listHistoryKeys().slice(0, limit);
  return NextResponse.json({ conversations });
}
