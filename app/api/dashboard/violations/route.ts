import { listViolations, violationCount } from '../../../../lib/guardrails/violationLog';
import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const violations = listViolations(limit);
  return NextResponse.json({ violations, total: violationCount() });
}
