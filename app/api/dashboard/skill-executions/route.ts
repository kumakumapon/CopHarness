import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { listSkillExecutions } from '../../../../lib/skills/executionLog';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 100) : 50;

  const executions = listSkillExecutions(limit);
  return NextResponse.json({ executions, total: executions.length });
}
