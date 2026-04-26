/**
 * Unit tests for POST /api/copilot
 *
 * The copilotClient module is mocked so no real network calls are made.
 */

jest.mock('@github/copilot-sdk', () => ({}));
import { POST } from '../../app/api/copilot/route';
import { NextRequest } from 'next/server';

jest.mock('../../lib/adapterFactory', () => ({
  createAdapter: jest.fn(),
  resolveProvider: jest.fn(),
}));
import * as adapterFactory from '../../lib/adapterFactory';
import * as adapterModule from '../../lib/adapter';

const mockComplete = jest.fn();

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/copilot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}


describe('POST /api/copilot', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockComplete.mockReset();
    mockComplete.mockResolvedValue({ content: 'こんにちは！今日はどうされましたか？' });
    (adapterFactory.createAdapter as jest.Mock).mockReturnValue({
      complete: mockComplete,
      provider: 'copilot',
      model: 'gpt-5-mini',
    } as unknown as adapterModule.LLMAdapter);
    (adapterFactory.resolveProvider as jest.Mock).mockReturnValue('copilot');
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('returns 401 when no API key is set', async () => {
    delete process.env.GITHUB_COPILOT_API_KEY;
    delete process.env.COPILOT_PROVIDER_API_KEY;
    delete process.env.COPILOT_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'hello' }] }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/Missing API key/);
  });

  it('returns 400 when messages field is missing', async () => {
    process.env.GITHUB_COPILOT_API_KEY = 'test-key';
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('messages');
  });

  it('returns 400 when messages is an empty array', async () => {
    process.env.GITHUB_COPILOT_API_KEY = 'test-key';
    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    process.env.GITHUB_COPILOT_API_KEY = 'test-key';
    const req = new NextRequest('http://localhost:3000/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 200 with reply on success', async () => {
    process.env.GITHUB_COPILOT_API_KEY = 'test-key';
    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'こんにちは' }] })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('reply');
    expect(typeof data.reply).toBe('string');
    expect(data.reply.length).toBeGreaterThan(0);
  });

  it('returns 502 when adapter throws a generic error', async () => {
    process.env.GITHUB_COPILOT_API_KEY = 'test-key';
    mockComplete.mockRejectedValueOnce(new Error('API failure'));
    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'hello' }] })
    );
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe('LLM API error');
  });

  it('returns 504 when adapter times out', async () => {
    process.env.GITHUB_COPILOT_API_KEY = 'test-key';
    mockComplete.mockRejectedValueOnce(new Error('Request timed out'));
    const res = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'hello' }] })
    );
    expect(res.status).toBe(504);
    const data = await res.json();
    expect(data.error).toContain('timed out');
  });
})

