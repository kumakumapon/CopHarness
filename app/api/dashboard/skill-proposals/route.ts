import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { querySkillProposals, type SkillProposalStatus } from '../../../../lib/skillProposals/store';

const VALID_STATUSES = new Set<SkillProposalStatus>([
  'draft',
  'testing',
  'tests_failed',
  'awaiting_approval',
  'approved',
  'rejected',
  'registered',
]);

const VALID_RISK_LEVELS = new Set<string>(['low', 'medium', 'high']);

function optionalParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value ? value : undefined;
}

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 200) : 50;

  const statusParam = optionalParam(url, 'status') as SkillProposalStatus | undefined;
  const status = statusParam && VALID_STATUSES.has(statusParam) ? statusParam : undefined;

  const riskLevelParam = optionalParam(url, 'riskLevel');
  const riskLevel =
    riskLevelParam && VALID_RISK_LEVELS.has(riskLevelParam)
      ? (riskLevelParam as 'low' | 'medium' | 'high')
      : undefined;

  const result = querySkillProposals({
    limit,
    status,
    nameQuery: optionalParam(url, 'nameQuery'),
    riskLevel,
  });

  return NextResponse.json(result);
}
