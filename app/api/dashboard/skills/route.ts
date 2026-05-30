import { NextResponse } from 'next/server';
import { listSkills, listActiveSkills } from '../../../../lib/skill';
import '../../../../lib/skills/index';

export async function GET() {
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
