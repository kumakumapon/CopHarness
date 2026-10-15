import { NextRequest, NextResponse } from 'next/server';
import { isMinimalRuntime } from './lib/core/runtimeProfile';

export function middleware(request: NextRequest) {
  if (!isMinimalRuntime()) return NextResponse.next();
  const path = request.nextUrl.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return new NextResponse('CopHarness: minimal profile. Use the CLI or /api/copilot.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const coreApi = ['/api/health', '/api/copilot', '/api/copilot/stream', '/api/copilot/agent'];
  // Approval endpoints remain available for core tool policy and budget overrides.
  const approvalApi = /^\/api\/dashboard\/approvals(?:\/[^/]+\/(?:approve|reject))?$/.test(path);
  if (coreApi.includes(path) || approvalApi) return NextResponse.next();
  return NextResponse.json({ error: 'This feature is disabled in the minimal profile' }, { status: 404 });
}

export const config = { matcher: ['/', '/api/:path*', '/dashboard/:path*', '/playground/:path*', '/tutorials/:path*'] };
