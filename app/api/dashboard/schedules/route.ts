import { NextRequest, NextResponse } from 'next/server';
import { listSchedules, setEnabled, addSchedule } from '../../../../lib/scheduler/store';
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

export async function POST(req: NextRequest) {
  let body: { name?: string; cron?: string; prompt?: string; discordChannelId?: string; lineUserId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { name, cron, prompt, discordChannelId, lineUserId } = body;
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name (string) is required' }, { status: 400 });
  }
  if (typeof cron !== 'string' || !cron.trim()) {
    return NextResponse.json({ error: 'cron (string) is required' }, { status: 400 });
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json({ error: 'prompt (string) is required' }, { status: 400 });
  }
  const entry = addSchedule({
    name: name.trim(),
    cron: normalizeCron(cron.trim()),
    prompt: prompt.trim(),
    discordChannelId: typeof discordChannelId === 'string' ? discordChannelId.trim() || undefined : undefined,
    lineUserId: typeof lineUserId === 'string' ? lineUserId.trim() || undefined : undefined,
  });
  const nextRun = nextRunDate(normalizeCron(entry.cron), new Date())?.toISOString() ?? null;
  return NextResponse.json({ schedule: { ...entry, nextRun } }, { status: 201 });
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
