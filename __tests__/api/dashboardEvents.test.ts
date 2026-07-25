import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/dashboard/events/route';
import { eventBus } from '../../lib/events/bus';

describe('/api/dashboard/events', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    eventBus.clear();
  });

  afterEach(() => {
    process.env = originalEnv;
    eventBus.clear();
  });

  function makeRequest(
    url = 'http://localhost:3000/api/dashboard/events',
    init: ConstructorParameters<typeof NextRequest>[1] = {},
  ) {
    return new NextRequest(url, init);
  }

  // GET streams SSE indefinitely; grab the response then abort so jest exits.
  async function getAndAbort(
    url = 'http://localhost:3000/api/dashboard/events',
  ) {
    const controller = new AbortController();
    const req = makeRequest(url, { signal: controller.signal });
    const res = await GET(req);
    controller.abort();
    if (res.body) {
      try {
        await res.body.cancel();
      } catch {
        // ignore
      }
    }
    return res;
  }

  describe('authentication', () => {
    it('rejects unauthenticated POST when COPHARNESS_API_KEY is set', async () => {
      process.env.COPHARNESS_API_KEY = 'secret';
      const res = await POST(makeRequest(undefined, { method: 'POST', body: JSON.stringify({}) }));
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated GET when COPHARNESS_API_KEY is set', async () => {
      process.env.COPHARNESS_API_KEY = 'secret';
      const res = await getAndAbort();
      expect(res.status).toBe(401);
    });

    it('allows POST with a correct Bearer header and redacts skill args', async () => {
      process.env.COPHARNESS_API_KEY = 'secret';
      eventBus.emit('skill:start', {
        skillName: 'writeFile',
        args: { apiKey: 'sk-abcdefghijklmnopqrstuv', path: 'notes.md' },
      });

      const res = await POST(
        makeRequest(undefined, {
          method: 'POST',
          headers: { Authorization: 'Bearer secret' },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.events).toHaveLength(1);
      expect(data.events[0].payload.args).toMatchObject({
        apiKey: '[REDACTED]',
        path: 'notes.md',
      });
    });

    it('rejects GET with ?access_token when DASHBOARD_EVENTS_ALLOW_QUERY_TOKEN is unset', async () => {
      process.env.COPHARNESS_API_KEY = 'secret';
      delete process.env.DASHBOARD_EVENTS_ALLOW_QUERY_TOKEN;
      const res = await getAndAbort('http://localhost:3000/api/dashboard/events?access_token=secret');
      expect(res.status).toBe(401);
    });

    it('allows GET with ?access_token when DASHBOARD_EVENTS_ALLOW_QUERY_TOKEN=true', async () => {
      process.env.COPHARNESS_API_KEY = 'secret';
      process.env.DASHBOARD_EVENTS_ALLOW_QUERY_TOKEN = 'true';
      const res = await getAndAbort('http://localhost:3000/api/dashboard/events?access_token=secret');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    });

    it('allows POST and GET without credentials when COPHARNESS_API_KEY is unset', async () => {
      delete process.env.COPHARNESS_API_KEY;

      const postRes = await POST(makeRequest(undefined, { method: 'POST', body: JSON.stringify({}) }));
      expect(postRes.status).toBe(200);

      const getRes = await getAndAbort();
      expect(getRes.status).toBe(200);
    });
  });
});
