import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../../../../lib/apiAuth';
import { retryAgentDagNode } from '../../../../../../../lib/agents/dagRunner';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: NextRequest, context: RouteContext) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const planId = typeof (body as { planId?: unknown }).planId === 'string'
    ? (body as { planId: string }).planId.trim()
    : '';
  if (!planId) {
    return NextResponse.json({ error: 'planId (string) is required' }, { status: 400 });
  }

  try {
    const result = await retryAgentDagNode(id, planId);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 409 });
  }
}
