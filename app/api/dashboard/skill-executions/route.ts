import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { listSkills } from '../../../../lib/skill';
import { querySkillExecutions, type SkillExecutionStatus } from '../../../../lib/skills/executionLog';
import '../../../../lib/skills/index';

const VALID_STATUSES = new Set<SkillExecutionStatus>(['success', 'error', 'exception']);
const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high']);

function optionalParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value ? value : undefined;
}

function parseDateParam(url: URL, name: string): Date | undefined {
  const value = optionalParam(url, name);
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 100) : 50;
  const statusParam = optionalParam(url, 'status') as SkillExecutionStatus | undefined;
  const status = statusParam && VALID_STATUSES.has(statusParam) ? statusParam : undefined;
  const riskLevel = optionalParam(url, 'riskLevel');
  const skillName = optionalParam(url, 'skillName');

  const baseResult = querySkillExecutions({
    limit: 500,
    skillName,
    status,
    personQuery: optionalParam(url, 'personQuery'),
    channelQuery: optionalParam(url, 'channelQuery'),
    taskQuery: optionalParam(url, 'taskQuery'),
    approvalQuery: optionalParam(url, 'approvalQuery'),
    from: parseDateParam(url, 'from'),
    to: parseDateParam(url, 'to'),
  });

  const riskBySkill = new Map(listSkills().map((skill) => [skill.name, skill.riskLevel ?? 'low']));
  const enriched = baseResult.executions.map((execution) => ({
    ...execution,
    riskLevel: riskBySkill.get(execution.skillName) ?? 'low',
  }));
  const filtered = riskLevel && VALID_RISK_LEVELS.has(riskLevel)
    ? enriched.filter((execution) => execution.riskLevel === riskLevel)
    : enriched;

  return NextResponse.json({ executions: filtered.slice(0, limit), total: filtered.length });
}
