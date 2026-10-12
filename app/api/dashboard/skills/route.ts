import { NextRequest, NextResponse } from 'next/server';
import { listSkills, listActiveSkills } from '../../../../lib/core/skill';
import { listSkillExecutionSummaries } from '../../../../lib/core/logs/skillExecutionLog';
import { requireApiKey } from '../../../../lib/core/apiAuth';
import { describeSkillPolicy } from '../../../../lib/core/toolPolicy/policy';
import '../../../../lib/bootstrap';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const activeNames = new Set(listActiveSkills().map((s) => s.name));
  const metricsBySkill = new Map(listSkillExecutionSummaries().map((m) => [m.skillName, m]));
  const skills = listSkills().map((s) => ({
    name: s.name,
    description: s.description,
    category: s.category ?? 'utility',
    riskLevel: s.riskLevel ?? 'low',
    requiresEnv: s.requiresEnv ?? [],
    enabled: activeNames.has(s.name),
    hasOutputSchema: s.outputSchema !== undefined,
    approvalPolicy: describeSkillPolicy(s),
    metrics: metricsBySkill.get(s.name) ?? {
      skillName: s.name,
      totalRuns: 0,
      successRuns: 0,
      errorRuns: 0,
      exceptionRuns: 0,
      successRate: null,
      averageDurationMs: null,
    },
  }));
  return NextResponse.json({ skills });
}
