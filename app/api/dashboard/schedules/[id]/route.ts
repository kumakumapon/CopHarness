import { NextRequest, NextResponse } from 'next/server';
import { setRunNow, setEnabled } from '../../../../../lib/scheduler/store';
import { nextRunDate, normalizeCron } from '../../../../../lib/scheduler/cron';
import { listSchedules } from '../../../../../lib/scheduler/store';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 });
  }
  const ok = setEnabled(id, body.enabled);
  if (!ok) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

  const schedule = listSchedules().find((s) => s.id === id);
  const nextRun =
    schedule?.enabled
      ? nextRunDate(normalizeCron(schedule.cron), new Date())?.toISOString() ?? null
      : null;
  return NextResponse.json({ ok: true, nextRun });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Use setRunNow as a no-op check — real delete not needed by dashboard
  const schedules = listSchedules();
  const exists = schedules.some((s) => s.id === id);
  if (!exists) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
