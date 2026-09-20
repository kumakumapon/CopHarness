import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../../lib/apiAuth';
import { getTaskDetail } from '../../../../../lib/tasks/detail';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const detail = getTaskDetail(id);
  return NextResponse.json(detail ?? { error: 'Task not found' }, { status: detail ? 200 : 404,
    headers: { 'Cache-Control': 'no-store' } });
}
