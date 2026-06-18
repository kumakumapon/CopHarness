/**
 * Unit tests for lib/adapterFactory.ts
 */

// ---------------------------------------------------------------------------
// Adapter mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/adapters/copilotAdapter', () => ({
  CopilotAdapter: jest.fn().mockImplementation((model, timeoutMs) => ({
    provider: 'copilot',
    model,
    timeoutMs,
    complete: jest.fn(),
  })),
}));

jest.mock('../../lib/adapters/openaiAdapter', () => ({
  OpenAIAdapter: jest.fn().mockImplementation((model, apiKey, apiBaseUrl, timeoutMs) => ({
    provider: 'openai',
    model,
    apiKey,
    apiBaseUrl,
    timeoutMs,
    complete: jest.fn(),
  })),
}));

jest.mock('../../lib/adapters/anthropicAdapter', () => ({
  AnthropicAdapter: jest.fn().mockImplementation((model, apiKey, apiBaseUrl, timeoutMs) => ({
    provider: 'anthropic',
    model,
    apiKey,
    apiBaseUrl,
    timeoutMs,
    complete: jest.fn(),
  })),
}));

jest.mock('../../lib/adapters/lmstudioAdapter', () => ({
  LmStudioAdapter: jest.fn().mockImplementation((model, apiBaseUrl, timeoutMs) => ({
    provider: 'lmstudio',
    model,
    apiBaseUrl,
    timeoutMs,
    complete: jest.fn(),
  })),
}));

jest.mock('../../lib/adapters/lemonadeAdapter', () => ({
  LemonadeAdapter: jest.fn().mockImplementation((model, apiBaseUrl, timeoutMs) => ({
    provider: 'lemonade',
    model,
    apiBaseUrl,
    timeoutMs,
    complete: jest.fn(),
  })),
}));

jest.mock('../../lib/adapters/antigravityAdapter', () => ({
  AntigravityAdapter: jest.fn().mockImplementation((model, apiKey, timeoutMs) => ({
    provider: 'antigravity',
    model,
    apiKey,
    timeoutMs,
    complete: jest.fn(),
  })),
}));

jest.mock('../../lib/telemetry/instrumentedAdapter', () => ({
  InstrumentedAdapter: jest.fn().mockImplementation((inner) => inner),
}));

jest.mock('../../lib/cache/responseCache', () => ({
  isCacheEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock('../../lib/cache/cachedAdapter', () => ({
  CachedAdapter: jest.fn().mockImplementation((inner) => inner),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { resolveProvider, resolveModel, createAdapter } from '../../lib/adapterFactory';
import { CopilotAdapter } from '../../lib/adapters/copilotAdapter';
import { OpenAIAdapter } from '../../lib/adapters/openaiAdapter';
import { AnthropicAdapter } from '../../lib/adapters/anthropicAdapter';
import { LmStudioAdapter } from '../../lib/adapters/lmstudioAdapter';
import { LemonadeAdapter } from '../../lib/adapters/lemonadeAdapter';
import { AntigravityAdapter } from '../../lib/adapters/antigravityAdapter';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

const savedEnv = process.env;

const ALL_PROVIDER_VARS = [
  'COPILOT_PROVIDER',
  'COPILOT_MODEL',
  'COPILOT_API_KEY',
  'COPILOT_PROVIDER_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'LMSTUDIO_BASE_URL',
  'LMSTUDIO_MODEL',
  'LEMONADE_BASE_URL',
  'LEMONADE_MODEL',
  'ANTIGRAVITY_API_KEY',
  'ANTIGRAVITY_MODEL',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
];

beforeEach(() => {
  process.env = { ...savedEnv };
  for (const key of ALL_PROVIDER_VARS) {
    delete process.env[key];
  }
  jest.clearAllMocks();
});

afterAll(() => {
  process.env = savedEnv;
});

// ---------------------------------------------------------------------------
// resolveProvider()
// ---------------------------------------------------------------------------

describe('resolveProvider()', () => {
  it('returns explicit COPILOT_PROVIDER value when set to a valid provider', () => {
    process.env.COPILOT_PROVIDER = 'openai';
    expect(resolveProvider()).toBe('openai');
  });

  it('returns explicit COPILOT_PROVIDER = anthropic even when other keys are present', () => {
    process.env.COPILOT_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'ak-xxx'; // would otherwise win auto-detect
    expect(resolveProvider()).toBe('anthropic');
  });

  it('ignores invalid COPILOT_PROVIDER and falls through to auto-detection', () => {
    process.env.COPILOT_PROVIDER = 'notavalidprovider';
    process.env.OPENAI_API_KEY = 'sk-xxx';
    expect(resolveProvider()).toBe('openai');
  });

  it('auto-detects anthropic from ANTHROPIC_API_KEY when it is present', () => {
    process.env.ANTHROPIC_API_KEY = 'ak-xxx';
    process.env.OPENAI_API_KEY = 'sk-xxx';
    expect(resolveProvider()).toBe('anthropic');
  });

  it('auto-detects openai from OPENAI_API_KEY when only that key is present', () => {
    process.env.OPENAI_API_KEY = 'sk-xxx';
    expect(resolveProvider()).toBe('openai');
  });

  it('auto-detects lmstudio from LMSTUDIO_BASE_URL', () => {
    process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
    expect(resolveProvider()).toBe('lmstudio');
  });

  it('auto-detects lemonade from LEMONADE_BASE_URL (lower priority than lmstudio)', () => {
    process.env.LEMONADE_BASE_URL = 'http://localhost:8080';
    expect(resolveProvider()).toBe('lemonade');
  });

  it('lmstudio wins over lemonade when both base URLs are set', () => {
    process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234';
    process.env.LEMONADE_BASE_URL = 'http://localhost:8080';
    expect(resolveProvider()).toBe('lmstudio');
  });

  it('falls back to "copilot" when no provider clues are configured', () => {
    expect(resolveProvider()).toBe('copilot');
  });

  it('returns openai when a BYOK key (COPILOT_PROVIDER_API_KEY) is set and no other keys', () => {
    process.env.COPILOT_PROVIDER_API_KEY = 'byok-key';
    expect(resolveProvider()).toBe('openai');
  });

  it('returns openai when COPILOT_API_KEY is set and no other keys', () => {
    process.env.COPILOT_API_KEY = 'byok-key';
    expect(resolveProvider()).toBe('openai');
  });

  it('explicit COPILOT_PROVIDER = copilot is respected', () => {
    process.env.COPILOT_PROVIDER = 'copilot';
    process.env.OPENAI_API_KEY = 'sk-xxx'; // would normally auto-detect openai
    expect(resolveProvider()).toBe('copilot');
  });

  it('auto-detects antigravity from ANTIGRAVITY_API_KEY', () => {
    process.env.ANTIGRAVITY_API_KEY = 'aig-xxx';
    expect(resolveProvider()).toBe('antigravity');
  });

  it('explicit COPILOT_PROVIDER = antigravity is respected', () => {
    process.env.COPILOT_PROVIDER = 'antigravity';
    process.env.OPENAI_API_KEY = 'sk-xxx';
    expect(resolveProvider()).toBe('antigravity');
  });
});

// ---------------------------------------------------------------------------
// resolveModel()
// ---------------------------------------------------------------------------

describe('resolveModel()', () => {
  it('COPILOT_MODEL takes precedence over everything else', () => {
    process.env.COPILOT_MODEL = 'my-custom-model';
    process.env.OPENAI_MODEL = 'gpt-4o';
    expect(resolveModel('openai')).toBe('my-custom-model');
  });

  it('uses OPENAI_MODEL when COPILOT_MODEL is not set', () => {
    process.env.OPENAI_MODEL = 'gpt-4o';
    expect(resolveModel('openai')).toBe('gpt-4o');
  });

  it('uses ANTHROPIC_MODEL when COPILOT_MODEL is not set', () => {
    process.env.ANTHROPIC_MODEL = 'claude-opus-4';
    expect(resolveModel('anthropic')).toBe('claude-opus-4');
  });

  it('uses LMSTUDIO_MODEL when COPILOT_MODEL is not set', () => {
    process.env.LMSTUDIO_MODEL = 'local-llama';
    expect(resolveModel('lmstudio')).toBe('local-llama');
  });

  it('uses LEMONADE_MODEL when COPILOT_MODEL is not set', () => {
    process.env.LEMONADE_MODEL = 'lemonade-llm';
    expect(resolveModel('lemonade')).toBe('lemonade-llm');
  });

  it('falls back to default "claude-sonnet-4-20250514" for anthropic', () => {
    expect(resolveModel('anthropic')).toBe('claude-sonnet-4-20250514');
  });

  it('falls back to default "gpt-5-mini" for openai', () => {
    expect(resolveModel('openai')).toBe('gpt-5-mini');
  });

  it('falls back to "gpt-5-mini" when no provider is given', () => {
    expect(resolveModel()).toBe('gpt-5-mini');
  });

  it('falls back to "gpt-5-mini" for lmstudio when no model env var set', () => {
    expect(resolveModel('lmstudio')).toBe('gpt-5-mini');
  });

  it('falls back to "gpt-5-mini" for lemonade when no model env var set', () => {
    expect(resolveModel('lemonade')).toBe('gpt-5-mini');
  });

  it('COPILOT_MODEL overrides anthropic default', () => {
    process.env.COPILOT_MODEL = 'override-model';
    expect(resolveModel('anthropic')).toBe('override-model');
  });

  it('uses ANTIGRAVITY_MODEL when COPILOT_MODEL is not set', () => {
    process.env.ANTIGRAVITY_MODEL = 'gemini-2.5-pro';
    expect(resolveModel('antigravity')).toBe('gemini-2.5-pro');
  });

  it('falls back to "gemini-2.0-flash" for antigravity when no model env var set', () => {
    expect(resolveModel('antigravity')).toBe('gemini-2.0-flash');
  });
});

// ---------------------------------------------------------------------------
// createAdapter()
// ---------------------------------------------------------------------------

describe('createAdapter()', () => {
  it('throws when apiKey is missing for openai', () => {
    expect(() =>
      createAdapter({ provider: 'openai', model: 'gpt-5-mini' }),
    ).toThrow('apiKey is required for the OpenAI adapter');
  });

  it('throws when apiKey is missing for anthropic', () => {
    expect(() =>
      createAdapter({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
    ).toThrow('apiKey is required for the Anthropic adapter');
  });

  it('creates an OpenAIAdapter for the openai provider', () => {
    createAdapter({ provider: 'openai', model: 'gpt-5-mini', apiKey: 'sk-test' });
    expect(OpenAIAdapter).toHaveBeenCalledTimes(1);
    expect(OpenAIAdapter).toHaveBeenCalledWith('gpt-5-mini', 'sk-test', undefined, undefined);
  });

  it('creates an AnthropicAdapter for the anthropic provider', () => {
    createAdapter({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'ak-test',
      apiBaseUrl: 'https://api.example.com',
      timeoutMs: 5000,
    });
    expect(AnthropicAdapter).toHaveBeenCalledTimes(1);
    expect(AnthropicAdapter).toHaveBeenCalledWith(
      'claude-sonnet-4-20250514',
      'ak-test',
      'https://api.example.com',
      5000,
    );
  });

  it('creates an LmStudioAdapter for the lmstudio provider (no apiKey required)', () => {
    createAdapter({ provider: 'lmstudio', model: 'local-llama', apiBaseUrl: 'http://localhost:1234' });
    expect(LmStudioAdapter).toHaveBeenCalledTimes(1);
    expect(LmStudioAdapter).toHaveBeenCalledWith('local-llama', 'http://localhost:1234', undefined);
  });

  it('creates a LemonadeAdapter for the lemonade provider (no apiKey required)', () => {
    createAdapter({ provider: 'lemonade', model: 'local-model', apiBaseUrl: 'http://localhost:8080' });
    expect(LemonadeAdapter).toHaveBeenCalledTimes(1);
    expect(LemonadeAdapter).toHaveBeenCalledWith('local-model', 'http://localhost:8080', undefined);
  });

  it('creates a CopilotAdapter for the copilot provider', () => {
    createAdapter({ provider: 'copilot', model: 'gpt-5-mini' });
    expect(CopilotAdapter).toHaveBeenCalledTimes(1);
    expect(CopilotAdapter).toHaveBeenCalledWith('gpt-5-mini', undefined);
  });

  it('creates a CopilotAdapter as the default fallback for unknown provider', () => {
    // Cast to any to simulate an unknown provider reaching the default branch
    createAdapter({ provider: 'copilot', model: 'gpt-5-mini', timeoutMs: 3000 });
    expect(CopilotAdapter).toHaveBeenCalledWith('gpt-5-mini', 3000);
  });

  it('throws when apiKey is missing for antigravity', () => {
    expect(() =>
      createAdapter({ provider: 'antigravity', model: 'gemini-2.0-flash' }),
    ).toThrow('apiKey is required for the Antigravity adapter');
  });

  it('creates an AntigravityAdapter for the antigravity provider', () => {
    createAdapter({ provider: 'antigravity', model: 'gemini-2.0-flash', apiKey: 'aig-test', timeoutMs: 5000 });
    expect(AntigravityAdapter).toHaveBeenCalledTimes(1);
    expect(AntigravityAdapter).toHaveBeenCalledWith('gemini-2.0-flash', 'aig-test', 5000);
  });
});
