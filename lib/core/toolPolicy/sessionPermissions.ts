/**
 * Session-scoped skill permission store.
 *
 * When a policy rule uses `allowForSession`, the first invocation requires
 * human approval. On approval, a time-bounded permission is recorded here so
 * that subsequent invocations within the same session window are auto-allowed
 * without re-prompting.
 */

export interface SessionPermission {
  personId: string;
  skillName: string;
  grantedAt: number;
  expiresAt: number;
  ruleId?: string;
}

const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

const permissions = new Map<string, SessionPermission>();

function permissionKey(personId: string, skillName: string): string {
  return `${personId}::${skillName}`;
}

export function grantSessionPermission(
  personId: string,
  skillName: string,
  options: { ttlMs?: number; ruleId?: string } = {},
): SessionPermission {
  const ttlMs =
    options.ttlMs ??
    (Number(process.env.SESSION_PERMISSION_TTL_MS) || DEFAULT_SESSION_TTL_MS);
  const now = Date.now();
  const perm: SessionPermission = {
    personId,
    skillName,
    grantedAt: now,
    expiresAt: now + ttlMs,
    ruleId: options.ruleId,
  };
  permissions.set(permissionKey(personId, skillName), perm);
  return perm;
}

export function hasSessionPermission(personId: string, skillName: string): boolean {
  const perm = permissions.get(permissionKey(personId, skillName));
  if (!perm) return false;
  if (Date.now() > perm.expiresAt) {
    permissions.delete(permissionKey(personId, skillName));
    return false;
  }
  return true;
}

export function revokeSessionPermission(personId: string, skillName: string): boolean {
  return permissions.delete(permissionKey(personId, skillName));
}

export function listSessionPermissions(personId?: string): SessionPermission[] {
  const now = Date.now();
  const result: SessionPermission[] = [];
  for (const [key, perm] of permissions.entries()) {
    if (perm.expiresAt <= now) {
      permissions.delete(key);
      continue;
    }
    if (personId && perm.personId !== personId) continue;
    result.push({ ...perm });
  }
  return result.sort((a, b) => b.grantedAt - a.grantedAt);
}

export function cleanupExpiredPermissions(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, perm] of permissions.entries()) {
    if (perm.expiresAt <= now) {
      permissions.delete(key);
      removed++;
    }
  }
  return removed;
}

export function _resetSessionPermissionsForTests(): void {
  permissions.clear();
}
