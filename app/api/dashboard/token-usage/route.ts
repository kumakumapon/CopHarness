import { NextRequest, NextResponse } from 'next/server';
import { getTokenUsageSummary } from '../../../../lib/extensions/telemetry/tokenTracker';
import { requireApiKey } from '../../../../lib/core/apiAuth';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ usage: getTokenUsageSummary() });
}
