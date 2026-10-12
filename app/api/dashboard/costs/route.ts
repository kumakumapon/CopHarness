import { NextRequest, NextResponse } from 'next/server';
import { getTotalSpend } from '../../../../lib/extensions/telemetry/costEstimator';
import { requireApiKey } from '../../../../lib/core/apiAuth';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const { totalUsd, breakdown } = getTotalSpend();

  return NextResponse.json({
    estimates: breakdown,
    totalUsd,
    currency: 'USD',
    note: 'Estimates based on published pricing. Actual costs may vary.',
  });
}
