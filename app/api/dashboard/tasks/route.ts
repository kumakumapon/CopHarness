import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { queryTasks, type TaskStatus } from '../../../../lib/tasks/ledger';

const VALID_STATUSES = new Set<TaskStatus>(['running', 'succeeded', 'failed', 'cancelled']);

function optionalParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value ? value : undefined;
}

function parseDateParam(url: URL, name: string): Date | undefined {
  const value = optionalParam(url, name);
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 100) : 50;
  const statusParam = optionalParam(url, 'status') as TaskStatus | undefined;
  const status = statusParam && VALID_STATUSES.has(statusParam) ? statusParam : undefined;

  const result = queryTasks({
    limit,
    status,
    kindQuery: optionalParam(url, 'kindQuery'),
    personQuery: optionalParam(url, 'personQuery'),
    channelQuery: optionalParam(url, 'channelQuery'),
    from: parseDateParam(url, 'from'),
    to: parseDateParam(url, 'to'),
  });

  return NextResponse.json(result);
}
