import { NextRequest, NextResponse } from 'next/server';
import { getTokenUsageSummary } from '../../../../lib/telemetry/tokenTracker';
import { requireApiKey } from '../../../../lib/apiAuth';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ usage: getTokenUsageSummary() });
}
