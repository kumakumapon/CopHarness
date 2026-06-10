import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { dispatchWatcherEvent } from '../../../../lib/watchers/engine';
import type { WatcherEvent } from '../../../../lib/watchers/types';

function eventFromBody(body: Partial<WatcherEvent>): WatcherEvent | { error: string } {
  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : '';
  if (!source) return { error: 'source (string) is required' };

  return {
    source,
    type: typeof body.type === 'string' && body.type.trim() ? body.type.trim() : undefined,
    subject: typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : undefined,
    payload: body.payload,
    receivedAt: typeof body.receivedAt === 'string' && body.receivedAt.trim() ? body.receivedAt.trim() : undefined,
  };
}

export async function POST(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  let body: Partial<WatcherEvent>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const event = eventFromBody(body);
  if ('error' in event) return NextResponse.json({ error: event.error }, { status: 400 });

  const dispatch = await dispatchWatcherEvent(event);
  const failed = dispatch.results.filter((result) => !result.ok).length;
  return NextResponse.json({
    ok: failed === 0,
    matched: dispatch.matched,
    failed,
    event: dispatch.event,
    results: dispatch.results,
  }, { status: failed > 0 ? 207 : 200 });
}
