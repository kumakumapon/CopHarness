import { NextRequest, NextResponse } from 'next/server';
import { listSchedules, setEnabled } from '../../../../lib/scheduler/store';
import { nextRunDate, normalizeCron } from '../../../../lib/scheduler/cron';

export async function GET() {
  const schedules = listSchedules().map((s) => {
    const nextRun = s.enabled
      ? nextRunDate(normalizeCron(s.cron), new Date())?.toISOString() ?? null
      : null;
    return { ...s, nextRun };
  });
  return NextResponse.json({ schedules });
}

export async function PATCH(req: NextRequest) {
  let body: { id?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { id, enabled } = body;
  if (typeof id !== 'string' || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'id (string) and enabled (boolean) are required' }, { status: 400 });
  }
  const ok = setEnabled(id, enabled);
  if (!ok) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
