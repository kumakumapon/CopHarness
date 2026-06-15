/**
 * Unit tests for GET /api/health
 */

jest.mock('../../lib/adapterFactory', () => ({
  resolveProvider: jest.fn().mockReturnValue('copilot'),
  resolveModel: jest.fn().mockReturnValue('gpt-4o'),
  createAdapter: jest.fn(),
}));

import { GET } from '../../app/api/health/route';

describe('GET /api/health', () => {
  it('returns 200', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('returns status "ok"', async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('response includes uptime field with seconds and startedAt', async () => {
    const res = await GET();
    const data = await res.json();
    expect(data).toHaveProperty('uptime');
    expect(typeof data.uptime.seconds).toBe('number');
    expect(data.uptime.seconds).toBeGreaterThanOrEqual(0);
    expect(typeof data.uptime.startedAt).toBe('string');
  });

  it('response includes provider field with active provider and model', async () => {
    const res = await GET();
    const data = await res.json();
    expect(data).toHaveProperty('provider');
    expect(data.provider.active).toBe('copilot');
    expect(data.provider.model).toBe('gpt-4o');
    expect(typeof data.provider.configured).toBe('object');
  });

  it('response includes memory field with heap and rss info', async () => {
    const res = await GET();
    const data = await res.json();
    expect(data).toHaveProperty('memory');
    expect(typeof data.memory.rss).toBe('number');
    expect(typeof data.memory.heapUsed).toBe('number');
    expect(typeof data.memory.heapTotal).toBe('number');
    expect(typeof data.memory.external).toBe('number');
  });

  it('response includes runtime field with node, platform and arch', async () => {
    const res = await GET();
    const data = await res.json();
    expect(data).toHaveProperty('runtime');
    expect(typeof data.runtime.node).toBe('string');
    expect(typeof data.runtime.platform).toBe('string');
    expect(typeof data.runtime.arch).toBe('string');
  });

  it('response includes a timestamp string', async () => {
    const res = await GET();
    const data = await res.json();
    expect(typeof data.timestamp).toBe('string');
    expect(() => new Date(data.timestamp)).not.toThrow();
  });
});
