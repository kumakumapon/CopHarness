import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { getSearchIndex, isSearchIndexEnabled, type SearchDocType } from '../../../../lib/search/index';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';

  // Empty query → return empty result immediately
  if (!q || !isSearchIndexEnabled()) {
    return NextResponse.json({ hits: [], total: 0 });
  }

  const rawType = url.searchParams.get('type')?.trim() ?? '';
  const type: SearchDocType | undefined =
    rawType === 'conversation' || rawType === 'task' ? rawType : undefined;

  const limitParam = Number(url.searchParams.get('limit') ?? '20');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 20) : 20;

  const index = getSearchIndex();
  const hits = index.search({ query: q, type, limit });

  return NextResponse.json({ hits, total: hits.length });
}
