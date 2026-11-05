/**
 * The HTTP API always requires a bearer token, because the agent can run
 * shell commands. COPHARNESS_API_KEY is used when set; otherwise a random
 * token is generated once in `<dataDir>/access-token` and printed at startup.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function accessTokenFile(dataDir: string): string {
  return path.join(dataDir, 'access-token');
}

export function getAccessToken(dataDir: string, env: Record<string, string | undefined> = process.env): { token: string; source: 'env' | 'file' } {
  const fromEnv = env.COPHARNESS_API_KEY?.trim();
  if (fromEnv) return { token: fromEnv, source: 'env' };
  const file = accessTokenFile(dataDir);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return { token: existing, source: 'file' };
  } catch { /* create below */ }
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(24).toString('base64url');
  try {
    fs.writeFileSync(file, token + '\n', { mode: 0o600, flag: 'wx' });
    return { token, source: 'file' };
  } catch {
    // Another process created it first.
    return { token: fs.readFileSync(file, 'utf8').trim(), source: 'file' };
  }
}

export function tokensEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const len = Math.max(a.length, b.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  a.copy(pa);
  b.copy(pb);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

export interface HeaderCarrier { headers: { get(name: string): string | null } }

/** Extract the bearer token from Authorization (or X-API-Key). */
export function bearerToken(req: HeaderCarrier): string | undefined {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || undefined;
  return req.headers.get('x-api-key')?.trim() || undefined;
}

export function isAuthorized(req: HeaderCarrier, dataDir: string): boolean {
  const provided = bearerToken(req);
  if (!provided) return false;
  return tokensEqual(provided, getAccessToken(dataDir).token);
}

export function webUrl(token: string, port = process.env.PORT || '3000'): string {
  return `http://localhost:${port}/#token=${token}`;
}
