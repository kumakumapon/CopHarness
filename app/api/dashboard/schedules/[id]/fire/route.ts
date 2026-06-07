import { NextRequest, NextResponse } from 'next/server';
import { setRunNow } from '../../../../../../lib/scheduler/store';
import { requireApiKey } from '../../../../../../lib/apiAuth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const ok = setRunNow(id, true);
  if (!ok) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
