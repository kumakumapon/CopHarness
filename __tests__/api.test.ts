import * as fs from 'node:fs';
import * as path from 'node:path';
import { setRuntimeForTests } from '../lib/runtime';
import { getAccessToken, isAuthorized } from '../lib/server/auth';
import * as sessionsRoute from '../app/api/sessions/route';
import * as sessionRoute from '../app/api/sessions/[id]/route';
import * as messagesRoute from '../app/api/sessions/[id]/messages/route';
import * as approvalsRoute from '../app/api/approvals/[id]/route';
import * as statusRoute from '../app/api/status/route';
import * as compatRoute from '../app/api/copilot/route';
import * as schedulesRoute from '../app/api/schedules/route';
import { ScriptedProvider, call, testRuntime, text, type Step } from './helpers';

const TOKEN = 'test-token';
const params = <P>(p: P) => ({ params: Promise.resolve(p) });
const req = (url: string, body?: unknown, token: string | null = TOKEN) => new Request(`http://localhost${url}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text.split('\n\n').filter(b => b.startsWith('data: ') && !b.includes('[DONE]')).map(b => JSON.parse(b.slice(6)));
}

describe('access token', () => {
  it('generates and reuses a token when COPHARNESS_API_KEY is unset', () => {
    const runtime = testRuntime(new ScriptedProvider([]));
    const { token, source } = getAccessToken(runtime.config.dataDir, {});
    expect(source).toBe('file');
    expect(getAccessToken(runtime.config.dataDir, {}).token).toBe(token);
    expect((fs.statSync(path.join(runtime.config.dataDir, 'access-token')).mode & 0o777).toString(8)).toBe('600');
    expect(getAccessToken(runtime.config.dataDir, { COPHARNESS_API_KEY: 'env' }).token).toBe('env');
    expect(isAuthorized({ headers: new Headers({ authorization: 'Bearer nope' }) }, runtime.config.dataDir)).toBe(false);
  });
});

describe('HTTP API', () => {
  const original = process.env.COPHARNESS_API_KEY;
  let provider: ScriptedProvider;

  beforeEach(() => {
    process.env.COPHARNESS_API_KEY = TOKEN;
  });
  afterEach(() => {
    setRuntimeForTests(undefined);
    if (original === undefined) delete process.env.COPHARNESS_API_KEY; else process.env.COPHARNESS_API_KEY = original;
  });

  function install(steps: Step[]) {
    provider = new ScriptedProvider(steps);
    const runtime = testRuntime(provider);
    setRuntimeForTests(runtime);
    return runtime;
  }

  it('requires the access token', async () => {
    install([]);
    expect((await statusRoute.GET(req('/api/status', undefined, null), params({}))).status).toBe(401);
    expect((await statusRoute.GET(req('/api/status', undefined, 'wrong'), params({}))).status).toBe(401);
    const ok = await statusRoute.GET(req('/api/status'), params({}));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.model).toBe('openai/test-model');
    expect(body.tools.map((t: { name: string }) => t.name)).toContain('bash');
  });

  it('creates a session and streams the turn', async () => {
    install([text('hello back')]);
    const res = await sessionsRoute.POST(req('/api/sessions', { message: 'hello' }), params({}));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const id = res.headers.get('x-session-id')!;
    const events = await readEvents(res);
    expect(events[0]).toMatchObject({ type: 'turn_start', sessionId: id });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', text: 'hello back', stopReason: 'end_turn' });
    const list = await (await sessionsRoute.GET(req('/api/sessions'), params({}))).json();
    expect(list.sessions[0]).toMatchObject({ id, owner: 'web', title: 'hello' });
  });

  it('returns JSON with stream: false and validates input', async () => {
    install([text('json reply')]);
    const bad = await sessionsRoute.POST(req('/api/sessions', { message: '' }), params({}));
    expect(bad.status).toBe(400);
    const badMode = await sessionsRoute.POST(req('/api/sessions', { message: 'x', mode: 'yolo' }), params({}));
    expect(badMode.status).toBe(400);
    const res = await sessionsRoute.POST(req('/api/sessions', { message: 'hi', stream: false, owner: 'bot' }), params({}));
    const body = await res.json();
    expect(body).toMatchObject({ text: 'json reply', stopReason: 'end_turn' });
    const detail = await (await sessionRoute.GET(req(`/api/sessions/${body.sessionId}`), params({ id: body.sessionId }))).json();
    expect(detail.owner).toBe('api:bot');
    expect(detail.messages).toHaveLength(2);
  });

  it('approves a pending tool call over HTTP', async () => {
    const runtime = install([text('first'), call('write_file', { path: 'out.txt', content: 'ok' }), text('saved')]);
    const created = await (await sessionsRoute.POST(req('/api/sessions', { message: 'start', stream: false }), params({}))).json();
    const res = await messagesRoute.POST(req(`/api/sessions/${created.sessionId}/messages`, { message: 'save it' }), params({ id: created.sessionId }));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let approved = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      const m = buf.match(/"type":"permission_request","request":\{"id":"(perm_[^"]+)"/);
      if (m && !approved) {
        approved = true;
        const r = await approvalsRoute.POST(req(`/api/approvals/${m[1]}`, { decision: 'allow' }), params({ id: m[1] }));
        expect(r.status).toBe(200);
      }
    }
    expect(approved).toBe(true);
    expect(buf).toContain('"text":"saved"');
    expect(fs.readFileSync(path.join(runtime.config.workspace, 'out.txt'), 'utf8')).toBe('ok');
    const missing = await approvalsRoute.POST(req('/api/approvals/perm_gone', { decision: 'allow' }), params({ id: 'perm_gone' }));
    expect(missing.status).toBe(404);
  });

  it('changes model and mode of a session', async () => {
    install([text('x')]);
    const created = await (await sessionsRoute.POST(req('/api/sessions', { message: 'a', stream: false }), params({}))).json();
    const patch = new Request(`http://localhost/api/sessions/${created.sessionId}`, { method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'readonly' }) });
    const updated = await (await sessionRoute.PATCH(patch, params({ id: created.sessionId }))).json();
    expect(updated.permissionMode).toBe('readonly');
    const notFound = await sessionRoute.GET(req('/api/sessions/s_missing_123'), params({ id: 's_missing_123' }));
    expect(notFound.status).toBe(404);
  });

  it('keeps the v1 /api/copilot contract', async () => {
    install([text('compat reply')]);
    const res = await compatRoute.POST(req('/api/copilot', {
      messages: [{ role: 'system', content: 'be terse' }, { role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'now' }],
    }), params({}));
    const body = await res.json();
    expect(body.reply).toBe('compat reply');
    const request = provider.requests[0];
    expect(request.system).toContain('be terse');
    expect(request.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    const bad = await compatRoute.POST(req('/api/copilot', { messages: [] }), params({}));
    expect(bad.status).toBe(400);
  });

  it('manages schedules', async () => {
    install([]);
    const created = await schedulesRoute.POST(req('/api/schedules', { cron: '07:15', prompt: 'news', deliver: { channel: 'slack', to: 'C1' } }), params({}));
    expect(created.status).toBe(201);
    const list = await (await schedulesRoute.GET(req('/api/schedules'), params({}))).json();
    expect(list.schedules[0]).toMatchObject({ cron: '15 7 * * *', deliver: { channel: 'slack', to: 'C1' } });
    expect(list.schedules[0].nextRunAt).toBeTruthy();
    const bad = await schedulesRoute.POST(req('/api/schedules', { cron: 'never', prompt: 'x' }), params({}));
    expect(bad.status).toBe(400);
  });
});

describe('every API route authenticates', () => {
  it('uses route() except the public health check and the signed webhooks', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p); else if (e.name === 'route.ts') files.push(p);
      }
    };
    walk(path.join(__dirname, '..', 'app', 'api'));
    const exempt = ['health', 'line', 'slack'].map(n => path.join('api', n, 'route.ts'));
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if (exempt.some(e => file.endsWith(e))) continue;
      const handlers = source.match(/export (const|async function) (GET|POST|PATCH|DELETE|PUT)/g) ?? [];
      const wrapped = source.match(/export const (GET|POST|PATCH|DELETE|PUT) = route/g) ?? [];
      expect({ file, count: wrapped.length }).toEqual({ file, count: handlers.length });
    }
    expect(files.length).toBeGreaterThan(10);
  });
});
