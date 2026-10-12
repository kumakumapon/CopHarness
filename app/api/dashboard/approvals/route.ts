import { NextRequest, NextResponse } from 'next/server';
import { listApprovalRequests } from '../../../../lib/core/humanInLoop/store';
import type { ApprovalStatus } from '../../../../lib/core/humanInLoop/types';
import { requireApiKey } from '../../../../lib/core/apiAuth';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const status = url.searchParams.get('status') as ApprovalStatus | null;
  const requests = listApprovalRequests(status ?? undefined);
  return NextResponse.json({ approvals: requests, total: requests.length });
}
