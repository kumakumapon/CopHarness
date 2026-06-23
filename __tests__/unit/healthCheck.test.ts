/**
 * Unit tests for lib/adapters/healthCheck.ts
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

jest.mock('../../lib/adapterFactory', () => ({
  createAdapter: jest.fn(),
  resolveApiKey: jest.fn().mockReturnValue(undefined),
  resolveModel: jest.fn().mockImplementation((provider?: string) => {
    if (provider === 'anthropic') return 'claude-sonnet-4-20250514';
    if (provider === 'openai') return 'gpt-5-mini';
    if (provider === 'antigravity') return 'gemini-2.0-flash';
    return 'gpt-5-mini';
  }),
}));

jest.mock('../../lib/telemetry/instrumentedAdapter', () => ({
  InstrumentedAdapter: jest.fn().mockImplementation((inner: unknown) => inner),
}));

jest.mock('../../lib/cache/responseCache', () => ({
  isCacheEnabled: jest.fn().mockReturnValue(false),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { checkAdapterHealth, checkAllProviders } from '../../lib/adapters/healthCheck';
import { type LLMAdapter } from '../../lib/adapter';
import { createAdapter, resolveModel } from '../../lib/adapterFactory';

const mockCreateAdapter = createAdapter as jest.MockedFunction<typeof createAdapter>;
const mockResolveModel = resolveModel as jest.MockedFunction<typeof resolveModel>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(
  provider: string,
  model: string,
  complete: jest.Mock = jest.fn().mockResolvedValue({ content: 'Hi there!' }),
  destroy?: jest.Mock,
): LLMAdapter {
  const adapter: LLMAdapter = {
    provider,
    model,
    complete,
  };
  if (destroy) {
    adapter.destroy = destroy;
  }
  return adapter;
}

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

const savedEnv = process.env;

const PROVIDER_VARS = [
  'OPENAI_API_KEY',
  'COPILOT_PROVIDER_API_KEY',
  'COPILOT_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'ANTIGRAVITY_API_KEY',
  'LMSTUDIO_BASE_URL',
  'LEMONADE_BASE_URL',
];

beforeEach(() => {
  process.env = { ...savedEnv };
  for (const key of PROVIDER_VARS) {
    delete process.env[key];
  }
  jest.clearAllMocks();
  // Default: resolveModel returns 'gpt-5-mini' unless overridden per test
  mockResolveModel.mockImplementation((provider?: string) => {
    if (provider === 'anthropic') return 'claude-sonnet-4-20250514';
    if (provider === 'openai') return 'gpt-5-mini';
    if (provider === 'antigravity') return 'gemini-2.0-flash';
    return 'gpt-5-mini';
  });
});

afterAll(() => {
  process.env = savedEnv;
});

// ---------------------------------------------------------------------------
// checkAdapterHealth()
// ---------------------------------------------------------------------------

describe('checkAdapterHealth()', () => {
  it('returns healthy: true when the adapter responds', async () => {
    const adapter = makeAdapter('openai', 'gpt-5-mini');
    const result = await checkAdapterHealth(adapter, 5000);

    expect(result.healthy).toBe(true);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-5-mini');
    expect(result.error).toBeUndefined();
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.checkedAt).toBe('string');
    expect(() => new Date(result.checkedAt)).not.toThrow();
  });

  it('sends a minimal [Hi] message to the adapter', async () => {
    const complete = jest.fn().mockResolvedValue({ content: 'Hello!' });
    const adapter = makeAdapter('anthropic', 'claude-sonnet-4-20250514', complete);
    await checkAdapterHealth(adapter, 5000);

    expect(complete).toHaveBeenCalledTimes(1);
    const callArg = complete.mock.calls[0][0];
    expect(callArg.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('returns healthy: false when the adapter throws', async () => {
    const complete = jest.fn().mockRejectedValue(new Error('Connection refused'));
    const adapter = makeAdapter('openai', 'gpt-5-mini', complete);
    const result = await checkAdapterHealth(adapter, 5000);

    expect(result.healthy).toBe(false);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-5-mini');
    expect(result.error).toBe('Connection refused');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('captures non-Error thrown values as strings', async () => {
    const complete = jest.fn().mockRejectedValue('timeout');
    const adapter = makeAdapter('openai', 'gpt-5-mini', complete);
    const result = await checkAdapterHealth(adapter, 5000);

    expect(result.healthy).toBe(false);
    expect(result.error).toBe('timeout');
  });

  it('handles timeout: abort signal causes adapter to throw', async () => {
    const complete = jest.fn().mockImplementation(
      ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (abortSignal) {
            abortSignal.addEventListener('abort', () =>
              reject(new Error('Request aborted')),
            );
          }
        }),
    );
    const adapter = makeAdapter('openai', 'gpt-5-mini', complete);

    // Use a very short timeout to trigger abort
    const result = await checkAdapterHealth(adapter, 10);

    expect(result.healthy).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('uses default timeout of 10000ms when not specified', async () => {
    const complete = jest.fn().mockResolvedValue({ content: 'ok' });
    const adapter = makeAdapter('copilot', 'gpt-5-mini', complete);
    const result = await checkAdapterHealth(adapter);

    expect(result.healthy).toBe(true);
    // Verify timeoutMs was passed in the request
    expect(complete.mock.calls[0][0].timeoutMs).toBe(10000);
  });

  it('does not throw even when adapter throws a non-standard error', async () => {
    const complete = jest.fn().mockRejectedValue(null);
    const adapter = makeAdapter('openai', 'gpt-5-mini', complete);
    // Should never reject
    await expect(checkAdapterHealth(adapter, 5000)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// checkAllProviders()
// ---------------------------------------------------------------------------

describe('checkAllProviders()', () => {
  it('checks multiple providers in parallel and returns one result per provider', async () => {
    const openaiAdapter = makeAdapter('openai', 'gpt-5-mini');
    const anthropicAdapter = makeAdapter('anthropic', 'claude-sonnet-4-20250514');

    mockCreateAdapter
      .mockReturnValueOnce(openaiAdapter)
      .mockReturnValueOnce(anthropicAdapter);

    const results = await checkAllProviders({
      providers: ['openai', 'anthropic'],
      timeoutMs: 5000,
    });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.healthy)).toBe(true);
    const providers = results.map((r) => r.provider);
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
  });

  it('returns healthy: false for a provider whose adapter throws on create', async () => {
    mockCreateAdapter.mockImplementationOnce(() => {
      throw new Error('apiKey is required for the OpenAI adapter');
    });

    const results = await checkAllProviders({
      providers: ['openai'],
      timeoutMs: 5000,
    });

    expect(results).toHaveLength(1);
    expect(results[0].healthy).toBe(false);
    expect(results[0].provider).toBe('openai');
    expect(results[0].error).toContain('apiKey is required');
  });

  it('returns healthy: false for a provider whose complete() rejects', async () => {
    const failingAdapter = makeAdapter(
      'anthropic',
      'claude-sonnet-4-20250514',
      jest.fn().mockRejectedValue(new Error('Unauthorized')),
    );
    mockCreateAdapter.mockReturnValueOnce(failingAdapter);

    const results = await checkAllProviders({
      providers: ['anthropic'],
      timeoutMs: 5000,
    });

    expect(results).toHaveLength(1);
    expect(results[0].healthy).toBe(false);
    expect(results[0].error).toBe('Unauthorized');
  });

  it('calls destroy() on adapters after checking', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter('openai', 'gpt-5-mini', jest.fn().mockResolvedValue({ content: 'ok' }), destroy);
    mockCreateAdapter.mockReturnValueOnce(adapter);

    await checkAllProviders({ providers: ['openai'], timeoutMs: 5000 });

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('calls destroy() even when complete() fails', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter(
      'openai',
      'gpt-5-mini',
      jest.fn().mockRejectedValue(new Error('fail')),
      destroy,
    );
    mockCreateAdapter.mockReturnValueOnce(adapter);

    await checkAllProviders({ providers: ['openai'], timeoutMs: 5000 });

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('only checks configured providers when providers option is omitted', async () => {
    // Only anthropic is configured (in addition to copilot which is always available)
    process.env.ANTHROPIC_API_KEY = 'ak-test';

    // Return distinct adapters per provider so provider names are correct
    mockCreateAdapter.mockImplementation(({ provider }: { provider: string }) =>
      makeAdapter(provider, 'gpt-5-mini'),
    );

    const results = await checkAllProviders({ timeoutMs: 5000 });

    // copilot is always included; anthropic because key is set
    const providerNames = results.map((r) => r.provider);
    expect(providerNames).toContain('copilot');
    expect(providerNames).toContain('anthropic');
    // openai should not be included (no OPENAI_API_KEY set)
    expect(providerNames).not.toContain('openai');
  });

  it('includes lmstudio when LMSTUDIO_BASE_URL is set', async () => {
    process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
    mockCreateAdapter.mockReturnValue(makeAdapter('lmstudio', 'gpt-5-mini'));

    const results = await checkAllProviders({ timeoutMs: 5000 });
    const providerNames = results.map((r) => r.provider);
    expect(providerNames).toContain('lmstudio');
  });

  it('includes lemonade when LEMONADE_BASE_URL is set', async () => {
    process.env.LEMONADE_BASE_URL = 'http://localhost:8080';
    mockCreateAdapter.mockReturnValue(makeAdapter('lemonade', 'gpt-5-mini'));

    const results = await checkAllProviders({ timeoutMs: 5000 });
    const providerNames = results.map((r) => r.provider);
    expect(providerNames).toContain('lemonade');
  });

  it('includes antigravity when GEMINI_API_KEY is set', async () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    mockCreateAdapter.mockReturnValue(makeAdapter('antigravity', 'gemini-2.0-flash'));

    const results = await checkAllProviders({ timeoutMs: 5000 });
    const providerNames = results.map((r) => r.provider);
    expect(providerNames).toContain('antigravity');
  });

  it('all results include a checkedAt timestamp string', async () => {
    const adapter = makeAdapter('copilot', 'gpt-5-mini');
    mockCreateAdapter.mockReturnValue(adapter);

    const results = await checkAllProviders({
      providers: ['copilot'],
      timeoutMs: 5000,
    });

    for (const result of results) {
      expect(typeof result.checkedAt).toBe('string');
      expect(() => new Date(result.checkedAt)).not.toThrow();
    }
  });

  it('partial failure: healthy and unhealthy results are both returned', async () => {
    const goodAdapter = makeAdapter('copilot', 'gpt-5-mini');
    const badAdapter = makeAdapter(
      'openai',
      'gpt-5-mini',
      jest.fn().mockRejectedValue(new Error('Bad gateway')),
    );

    mockCreateAdapter
      .mockReturnValueOnce(goodAdapter)
      .mockReturnValueOnce(badAdapter);

    const results = await checkAllProviders({
      providers: ['copilot', 'openai'],
      timeoutMs: 5000,
    });

    expect(results).toHaveLength(2);
    const healthyCount = results.filter((r) => r.healthy).length;
    const unhealthyCount = results.filter((r) => !r.healthy).length;
    expect(healthyCount).toBe(1);
    expect(unhealthyCount).toBe(1);
  });
});
