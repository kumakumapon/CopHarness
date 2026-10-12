import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../../../lib/core/apiAuth';
import { getSkillProposal } from '../../../../../../lib/extensions/skill-proposals/store';
import { approveProposal } from '../../../../../../lib/extensions/skill-proposals/lifecycle';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;

  const existing = getSkillProposal(id);
  if (!existing) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  try {
    const proposal = await approveProposal(id);
    return NextResponse.json({ proposal });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
