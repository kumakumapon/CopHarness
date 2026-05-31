import { listLogs } from '../../../../lib/logs/store';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const logs = listLogs(limit);
  return NextResponse.json({ logs });
}
