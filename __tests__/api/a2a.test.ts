/**
 * Unit tests for POST /api/a2a
 *
 * The orchestrator module is mocked so no real LLM call is made.
 */
import { POST } from '../../app/api/a2a/route';
import { NextRequest } from 'next/server';

jest.mock('../../lib/agents/orchestrator', () => ({
  runAgentTask: jest.fn(),
  // lib/skills/index (imported for its side effects by the route) pulls in
  // lib/skills/spawnAgent, which reads this at module load time.
  BUILT_IN_ROLE_PROMPTS: {},
}));
import * as orchestrator from '../../lib/agents/orchestrator';

const mockRunAgentTask = orchestrator.runAgentTask as jest.Mock;

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/a2a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/a2a', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockRunAgentTask.mockReset();
    mockRunAgentTask.mockResolvedValue({
      taskId: 'task-1',
      role: 'assistant',
      content: 'hello there',
      model: 'gpt-5-mini',
      provider: 'copilot',
      durationMs: 12,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('returns 401 when COPHARNESS_API_KEY is set and no Authorization header is present', async () => {
    process.env.COPHARNESS_API_KEY = 'secret-key';
    const res = await POST(makeRequest({ task: { role: 'user', input: 'hi' } }));
    expect(res.status).toBe(401);
  });

  it('succeeds with a correct Bearer token when COPHARNESS_API_KEY is set', async () => {
    process.env.COPHARNESS_API_KEY = 'secret-key';
    const res = await POST(
      makeRequest(
        { task: { role: 'user', input: 'hi' } },
        { Authorization: 'Bearer secret-key' },
      ),
    );
    expect(res.status).toBe(200);
  });

  it('succeeds without any auth header when COPHARNESS_API_KEY is unset (backward compatibility)', async () => {
    delete process.env.COPHARNESS_API_KEY;
    const res = await POST(makeRequest({ task: { role: 'user', input: 'hi' } }));
    expect(res.status).toBe(200);
  });

  it('returns 400 when task.role and task.input are missing', async () => {
    delete process.env.COPHARNESS_API_KEY;
    const res = await POST(makeRequest({ task: { role: 'user' } }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('task.role and task.input are required');
  });

  it('returns 400 when task.skills is a bare string instead of an array', async () => {
    delete process.env.COPHARNESS_API_KEY;
    const res = await POST(
      makeRequest({ task: { role: 'user', input: 'hi', skills: 'webSearch' } }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/task\.skills/);
  });

  it('returns 400 when task.skills contains non-string entries', async () => {
    delete process.env.COPHARNESS_API_KEY;
    const res = await POST(
      makeRequest({ task: { role: 'user', input: 'hi', skills: [1, 2] } }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/task\.skills/);
  });

  it('clamps task.timeoutMs to the default COPILOT_TIMEOUT_MS when unset', async () => {
    delete process.env.COPHARNESS_API_KEY;
    delete process.env.COPILOT_TIMEOUT_MS;
    const res = await POST(
      makeRequest({ task: { role: 'user', input: 'hi', timeoutMs: 999999999 } }),
    );
    expect(res.status).toBe(200);
    expect(mockRunAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 120000 }),
    );
  });

  // Rate limiting exhausts the shared `defaultRateLimiter` singleton bucket,
  // so this must run last to avoid poisoning the tests above.
  it('returns 429 once the rate limit bucket is exhausted', async () => {
    delete process.env.COPHARNESS_API_KEY;
    let lastRes;
    for (let i = 0; i < 31; i += 1) {
      lastRes = await POST(makeRequest({ task: { role: 'user', input: 'hi' } }));
    }
    expect(lastRes!.status).toBe(429);
  });
});
