import { NextRequest, NextResponse } from 'next/server';
import { setEnabled, listSchedules, removeSchedule, updateSchedule } from '../../../../../lib/scheduler/store';
import { nextRunDate, normalizeCron } from '../../../../../lib/scheduler/cron';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { enabled?: boolean; name?: string; cron?: string; prompt?: string; discordChannelId?: string; lineUserId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // enabled toggle
  if (typeof body.enabled === 'boolean') {
    const ok = setEnabled(id, body.enabled);
    if (!ok) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    const schedule = listSchedules().find((s) => s.id === id);
    const nextRun =
      schedule?.enabled
        ? nextRunDate(normalizeCron(schedule.cron), new Date())?.toISOString() ?? null
        : null;
    return NextResponse.json({ ok: true, nextRun });
  }

  // field update
  const updates: { name?: string; cron?: string; prompt?: string; discordChannelId?: string; lineUserId?: string } = {};
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.cron === 'string' && body.cron.trim()) updates.cron = normalizeCron(body.cron.trim());
  if (typeof body.prompt === 'string' && body.prompt.trim()) updates.prompt = body.prompt.trim();
  if (typeof body.discordChannelId === 'string') {
    updates.discordChannelId = body.discordChannelId.trim() || undefined;
  }
  if (typeof body.lineUserId === 'string') {
    updates.lineUserId = body.lineUserId.trim() || undefined;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }
  const ok = updateSchedule(id, updates);
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
  const ok = removeSchedule(id);
  if (!ok) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
