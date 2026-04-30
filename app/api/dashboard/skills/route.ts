import { NextResponse } from 'next/server';
import { listSkills } from '../../../../lib/skill';
import '../../../../lib/skills/index';

export async function GET() {
  const skills = listSkills().map((s) => ({
    name: s.name,
    description: s.description,
    category: s.category ?? 'utility',
    riskLevel: s.riskLevel ?? 'low',
    requiresEnv: s.requiresEnv ?? [],
  }));
  return NextResponse.json({ skills });
}
