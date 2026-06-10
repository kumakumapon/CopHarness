import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { addWatcher, listWatchers } from '../../../../lib/watchers/store';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ watchers: listWatchers() });
}

export async function POST(req: NextRequest) {
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

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name (string) is required' }, { status: 400 });
  }
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return NextResponse.json({ error: 'prompt (string) is required' }, { status: 400 });
  }

  const watcher = addWatcher({
    name: body.name,
    type: typeof body.type === 'string' && body.type.trim() ? body.type : 'manual',
    prompt: body.prompt,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    eventPattern: body.eventPattern,
    discordChannelId: body.discordChannelId,
    lineUserId: body.lineUserId,
    metadata: body.metadata,
  });
  return NextResponse.json({ watcher }, { status: 201 });
}
