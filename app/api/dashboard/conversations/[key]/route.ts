import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../../lib/apiAuth';
import { loadHistory, clearHistory } from '../../../../../lib/history/store';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const { key } = await params;
  const messages = loadHistory(key);
  if (messages.length === 0) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  return NextResponse.json({
    key,
    messages,
    exportedAt: new Date().toISOString(),
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const { key } = await params;
  await clearHistory(key);
  return NextResponse.json({ ok: true });
}
