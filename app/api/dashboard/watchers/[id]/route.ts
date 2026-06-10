import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../../lib/apiAuth';
import { removeWatcher, updateWatcher } from '../../../../../lib/watchers/store';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  let body: {
    name?: string;
    type?: string;
    prompt?: string;
    enabled?: boolean;
    eventPattern?: string;
    discordChannelId?: string;
    lineUserId?: string;
    metadata?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { id } = await params;
  const watcher = updateWatcher(id, body);
  if (!watcher) return NextResponse.json({ error: 'Watcher not found' }, { status: 404 });
  return NextResponse.json({ watcher });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const ok = removeWatcher(id);
  if (!ok) return NextResponse.json({ error: 'Watcher not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
