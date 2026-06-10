import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../../../lib/apiAuth';
import { triggerWatcher } from '../../../../../../lib/watchers/engine';
import type { WatcherEvent } from '../../../../../../lib/watchers/types';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  let body: Partial<WatcherEvent> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { id } = await params;
  const result = await triggerWatcher(id, {
    source: typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'dashboard',
    type: typeof body.type === 'string' ? body.type : 'manual',
    subject: typeof body.subject === 'string' ? body.subject : undefined,
    payload: body.payload,
    receivedAt: typeof body.receivedAt === 'string' ? body.receivedAt : undefined,
  });

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ ok: true, watcher: result.watcher, result: result.result });
}
