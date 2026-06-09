import * as crypto from 'crypto';
import type { ApprovalRequest, ApprovalStatus } from './types';

const store = new Map<string, ApprovalRequest>();

export function createApprovalRequest(
  skillName: string,
  args: Record<string, unknown>,
  requestedBy?: string,
  policyRuleId?: string,
): ApprovalRequest {
  const id = crypto.randomBytes(8).toString('hex');
  const req: ApprovalRequest = {
    id,
    skillName,
    args,
    createdAt: Date.now(),
    status: 'pending',
    requestedBy,
    policyRuleId,
  };
  store.set(id, req);
  return req;
}

export function getApprovalRequest(id: string): ApprovalRequest | undefined {
  return store.get(id);
}

export function listApprovalRequests(status?: ApprovalStatus): ApprovalRequest[] {
  const all = Array.from(store.values());
  if (!status) return all.sort((a, b) => b.createdAt - a.createdAt);
  return all.filter((r) => r.status === status).sort((a, b) => b.createdAt - a.createdAt);
}

export function resolveApprovalRequest(
  id: string,
  status: 'approved' | 'rejected',
): boolean {
  const req = store.get(id);
  if (!req || req.status !== 'pending') return false;
  req.status = status;
  req.resolvedAt = Date.now();
  return true;
}

export async function waitForApproval(
  id: string,
  timeoutMs: number,
): Promise<ApprovalStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const req = store.get(id);
    if (!req) return 'timeout';
    if (req.status !== 'pending') return req.status;
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  const req = store.get(id);
  if (req && req.status === 'pending') {
    req.status = 'timeout';
    req.resolvedAt = Date.now();
  }
  return 'timeout';
}

export function cleanupOldRequests(maxAgeMs = 24 * 60 * 60 * 1000): void {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, req] of store.entries()) {
    if (req.createdAt < cutoff && req.status !== 'pending') {
      store.delete(id);
    }
  }
}
