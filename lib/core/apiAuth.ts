import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/**
 * Minimal request shape the auth check needs. Both `NextRequest` and the plain
 * `Request` handed to route handlers satisfy it.
 */
export interface AuthRequest {
  headers: { get(name: string): string | null };
}

/**
 * Reject the request unless it carries the configured API key.
 *
 * `queryToken` lets callers supply a credential from somewhere other than the
 * `Authorization` header — needed for `EventSource`, which cannot set headers.
 * Only pass it where the operator has explicitly opted in: URLs end up in
 * access logs and browser history.
 */
export function requireApiKey(req: AuthRequest, queryToken?: string | null): NextResponse | null {
  const expectedApiKey = process.env.COPHARNESS_API_KEY;
  if (!expectedApiKey) return null;

  const authHeader = req.headers.get('Authorization');
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const provided = headerToken ?? (queryToken?.trim() ? queryToken.trim() : null);
  if (!provided) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expectedApiKey);

  // timingSafeEqual requires equal-length buffers; pad to avoid length leak
  // while still rejecting mismatched lengths.
  const maxLen = Math.max(providedBuf.length, expectedBuf.length);
  const a = Buffer.alloc(maxLen);
  const b = Buffer.alloc(maxLen);
  providedBuf.copy(a);
  expectedBuf.copy(b);

  const match = timingSafeEqual(a, b) && providedBuf.length === expectedBuf.length;
  if (match) return null;

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
