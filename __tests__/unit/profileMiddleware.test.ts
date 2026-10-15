import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';

const env = process.env;
beforeEach(() => { process.env = { ...env, COPHARNESS_PROFILE: 'minimal' }; });
afterEach(() => { process.env = env; });

it.each(['/api/copilot', '/api/copilot/stream', '/api/copilot/agent', '/api/health', '/api/dashboard/approvals', '/api/dashboard/approvals/abc/approve', '/api/dashboard/approvals/abc/reject'])('keeps core route %s', url => {
  expect(middleware(new NextRequest(`http://localhost${url}`)).headers.get('x-middleware-next')).toBe('1');
});
it.each(['/api/a2a', '/api/line', '/api/slack', '/api/watchers/events', '/api/dashboard/schedules', '/api/dashboard/skill-proposals', '/api/dashboard/tasks', '/dashboard', '/playground', '/tutorials'])('disables optional surface %s', url => {
  expect(middleware(new NextRequest(`http://localhost${url}`)).status).toBe(404);
});
it('retains optional routes in full mode', () => {
  process.env.COPHARNESS_PROFILE = 'full';
  expect(middleware(new NextRequest('http://localhost/api/a2a')).headers.get('x-middleware-next')).toBe('1');
});
