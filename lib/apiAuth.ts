import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

export function requireApiKey(req: NextRequest): NextResponse | null {
  const expectedApiKey = process.env.COPHARNESS_API_KEY;
  if (!expectedApiKey) return null;

  const authHeader = req.headers.get('Authorization');
  const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
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
