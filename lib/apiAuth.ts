import { NextRequest, NextResponse } from 'next/server';

export function requireApiKey(req: NextRequest): NextResponse | null {
  const expectedApiKey = process.env.COPHARNESS_API_KEY;
  if (!expectedApiKey) return null;

  const authHeader = req.headers.get('Authorization');
  const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (provided === expectedApiKey) return null;

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
