import { NextRequest, NextResponse } from 'next/server';
import { setStopRequested } from '../../../../../../lib/scheduler/store';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = setStopRequested(id, true);
  if (!ok) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
