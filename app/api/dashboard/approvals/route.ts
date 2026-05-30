import { NextRequest, NextResponse } from 'next/server';
import { listApprovalRequests } from '../../../../lib/humanInLoop/store';
import type { ApprovalStatus } from '../../../../lib/humanInLoop/types';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') as ApprovalStatus | null;
  const requests = listApprovalRequests(status ?? undefined);
  return NextResponse.json({ approvals: requests, total: requests.length });
}
