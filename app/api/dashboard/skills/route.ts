import { NextRequest, NextResponse } from 'next/server';
import { listSkills, listActiveSkills } from '../../../../lib/skill';
import { requireApiKey } from '../../../../lib/apiAuth';
import '../../../../lib/skills/index';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const activeNames = new Set(listActiveSkills().map((s) => s.name));
  const skills = listSkills().map((s) => ({
    name: s.name,
    description: s.description,
    category: s.category ?? 'utility',
    riskLevel: s.riskLevel ?? 'low',
    requiresEnv: s.requiresEnv ?? [],
    enabled: activeNames.has(s.name),
    hasOutputSchema: s.outputSchema !== undefined,
  }));
  return NextResponse.json({ skills });
}
