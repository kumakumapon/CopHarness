import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { getBudgetSummary } from '../../../../lib/telemetry/budget';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;
  return NextResponse.json(getBudgetSummary());
}
