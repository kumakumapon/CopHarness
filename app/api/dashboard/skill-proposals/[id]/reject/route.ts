import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../../../lib/core/apiAuth';
import { getSkillProposal } from '../../../../../../lib/extensions/skill-proposals/store';
import { rejectProposal } from '../../../../../../lib/extensions/skill-proposals/lifecycle';

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

  let reason: string | undefined;
  try {
    const body = await req.json() as { reason?: string };
    if (body.reason) reason = String(body.reason);
  } catch {
    // No body or invalid JSON — reason stays undefined
  }

  try {
    const proposal = await rejectProposal(id, reason);
    return NextResponse.json({ proposal });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
