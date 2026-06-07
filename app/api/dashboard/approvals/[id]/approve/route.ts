import { NextRequest, NextResponse } from 'next/server';
import { resolveApprovalRequest } from '../../../../../../lib/humanInLoop/store';
import { requireApiKey } from '../../../../../../lib/apiAuth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const ok = resolveApprovalRequest(id, 'approved');
  if (!ok) {
    return NextResponse.json(
      { error: 'Approval request not found or already resolved' },
      { status: 404 },
    );
  }
  return NextResponse.json({ id, status: 'approved' });
}
