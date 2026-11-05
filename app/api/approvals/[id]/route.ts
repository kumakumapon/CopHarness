import { error, json, readJson, route } from '../../../../lib/server/http';
import type { PermissionDecision } from '../../../../lib/types';

export const dynamic = 'force-dynamic';

/** Answer a pending tool approval: {"decision": "allow" | "allow_always" | "deny"}. */
export const POST = route<{ id: string }>(async (req, { runtime, params }) => {
  const body = await readJson<{ decision?: unknown }>(req);
  const decision = body.decision as PermissionDecision;
  if (!['allow', 'allow_always', 'deny'].includes(decision)) return error('decision は allow / allow_always / deny のいずれかです', 400);
  return runtime.resolveApproval(params.id, decision, 'web') ? json({ ok: true }) : error('承認待ちのリクエストが見つかりません（期限切れの可能性があります）', 404);
});
