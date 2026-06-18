/**
 * Unit tests for the skill feature:
 * - SkillDefinition interface and registry
 * - currentDateTime built-in skill
 * - OpenAI and Anthropic adapter tool-calling loops
 */

import {
  registerSkill,
  getSkill,
  resolveSkills,
  MAX_SKILL_ITERATIONS,
  type SkillDefinition,
} from '../../lib/skill';
import { currentDateTime } from '../../lib/skills/currentDateTime';

// -----------------------------------------------------------------------
// Skill registry
// -----------------------------------------------------------------------

describe('skill registry', () => {
  const testSkill: SkillDefinition = {
    name: '__test_skill__',
    description: 'A test skill',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ content: 'test result' }),
  };

  beforeAll(() => {
    registerSkill(testSkill);
  });

  it('getSkill returns a registered skill by name', () => {
    expect(getSkill('__test_skill__')).toBe(testSkill);
  });

  it('getSkill returns undefined for unknown name', () => {
    expect(getSkill('__unknown__')).toBeUndefined();
  });

  it('resolveSkills returns known skills and silently drops unknown names', () => {
    const result = resolveSkills(['__test_skill__', '__unknown__']);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(testSkill);
  });

  it('resolveSkills returns empty array for empty input', () => {
    expect(resolveSkills([])).toEqual([]);
  });
});

// -----------------------------------------------------------------------
// currentDateTime built-in skill
// -----------------------------------------------------------------------

describe('currentDateTime skill', () => {
  it('has correct name and description', () => {
    expect(currentDateTime.name).toBe('currentDateTime');
    expect(currentDateTime.description).toMatch(/date/i);
  });

  it('handler returns an ISO 8601 string', async () => {
    const result = await currentDateTime.handler({});
    expect(result.isError).toBeFalsy();
    expect(() => new Date(result.content)).not.toThrow();
    expect(new Date(result.content).toISOString()).toBe(result.content);
  });
});

// -----------------------------------------------------------------------
// MAX_SKILL_ITERATIONS constant
// -----------------------------------------------------------------------

describe('MAX_SKILL_ITERATIONS', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(MAX_SKILL_ITERATIONS)).toBe(true);
    expect(MAX_SKILL_ITERATIONS).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------
// OpenAIAdapter skill tool-calling loop
// -----------------------------------------------------------------------

jest.mock('openai');
import OpenAI from 'openai';
import { OpenAIAdapter } from '../../lib/adapters/openaiAdapter';

describe('OpenAIAdapter skill tool-calling loop', () => {
  const echoSkill: SkillDefinition = {
    name: 'echo',
    description: 'Echoes back the input',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: 'The message to echo' } },
      required: ['message'],
    },
    handler: async (args) => ({ content: String(args.message ?? '') }),
  };

  let mockCreate: jest.Mock;
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    mockCreate = jest.fn();
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }));
    adapter = new OpenAIAdapter('gpt-4o', 'test-key');
  });

  it('returns text content directly when no tool calls are made', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'Hello!', tool_calls: [] } }],
    });

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      skills: [echoSkill],
    });
    expect(result.content).toBe('Hello!');
    expect(result.provider).toBe('openai');
  });

  it('executes tool call and sends result back, then returns final text', async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'echo', arguments: '{"message":"world"}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'The echo said: world' } }],
      });

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'Echo world' }],
      skills: [echoSkill],
    });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('The echo said: world');

    // Second call should include the tool result message
    const secondCallMessages = mockCreate.mock.calls[1][0].messages as Array<{ role: string }>;
    expect(secondCallMessages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('handles unknown skill gracefully', async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_unknown',
                  type: 'function',
                  function: { name: 'nonexistentSkill', arguments: '{}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'I could not use the tool.' } }],
      });

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'Use nonexistent skill' }],
      skills: [echoSkill],
    });
    expect(result.content).toBe('I could not use the tool.');
    const secondCallMessages = mockCreate.mock.calls[1][0].messages as Array<{ role: string; content?: string }>;
    const toolMsg = secondCallMessages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/Unknown skill/);
  });

  it('works without skills (backward compatible)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'No tools needed' } }],
    });

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.content).toBe('No tools needed');
    expect(mockCreate.mock.calls[0][0].tools).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// AnthropicAdapter skill tool-calling loop
// -----------------------------------------------------------------------

import { AnthropicAdapter } from '../../lib/adapters/anthropicAdapter';

describe('AnthropicAdapter skill tool-calling loop', () => {
  const echoSkill: SkillDefinition = {
    name: 'echo',
    description: 'Echoes input',
    parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    handler: async (args) => ({ content: String(args.message ?? '') }),
  };

  let adapter: AnthropicAdapter;

  beforeEach(() => {
    adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022', 'test-key');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns text content when stop_reason is end_turn', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'Hello from Anthropic!' }],
          stop_reason: 'end_turn',
        }),
        { status: 200 },
      ),
    );

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      skills: [echoSkill],
    });
    expect(result.content).toBe('Hello from Anthropic!');
    expect(result.provider).toBe('anthropic');
  });

  it('executes tool_use and appends tool_result, then returns final text', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              { type: 'tool_use', id: 'tu_1', name: 'echo', input: { message: 'hello' } },
            ],
            stop_reason: 'tool_use',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'Echo result: hello' }],
            stop_reason: 'end_turn',
          }),
          { status: 200 },
        ),
      );

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'Echo hello' }],
      skills: [echoSkill],
    });
    expect(result.content).toBe('Echo result: hello');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Second request body should contain tool_result
    const secondCall = (global.fetch as jest.Mock).mock.calls[1];
    const secondBody = JSON.parse(secondCall[1].body as string) as { messages: Array<{ role: string; content: unknown }> };
    const userMsg = secondBody.messages.find((m) => m.role === 'user' && Array.isArray(m.content));
    expect(userMsg).toBeDefined();
    const toolResultBlock = (userMsg!.content as Array<{ type: string }>).find((b) => b.type === 'tool_result');
    expect(toolResultBlock).toBeDefined();
  });

  it('works without skills (backward compatible)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'No tools' }],
          stop_reason: 'end_turn',
        }),
        { status: 200 },
      ),
    );

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.content).toBe('No tools');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string) as { tools?: unknown[] };
    expect(body.tools).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// LmStudioAdapter
// -----------------------------------------------------------------------

import { LmStudioAdapter, LMSTUDIO_DEFAULT_BASE_URL } from '../../lib/adapters/lmstudioAdapter';

describe('LmStudioAdapter', () => {
  let mockCreate: jest.Mock;
  let adapter: LmStudioAdapter;

  beforeEach(() => {
    mockCreate = jest.fn();
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }));
    adapter = new LmStudioAdapter('local-model');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('has provider "lmstudio"', () => {
    expect(adapter.provider).toBe('lmstudio');
  });

  it('uses the model passed to constructor', () => {
    expect(adapter.model).toBe('local-model');
  });

  it('exposes correct default base URL constant', () => {
    expect(LMSTUDIO_DEFAULT_BASE_URL).toBe('http://localhost:1234/v1');
  });

  it('returns text content and overrides provider to "lmstudio"', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'Hello from LM Studio!', tool_calls: [] } }],
    });

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(result.content).toBe('Hello from LM Studio!');
    expect(result.provider).toBe('lmstudio');
  });
});

// -----------------------------------------------------------------------
// LemonadeAdapter
// -----------------------------------------------------------------------

import { LemonadeAdapter, LEMONADE_DEFAULT_BASE_URL } from '../../lib/adapters/lemonadeAdapter';

describe('LemonadeAdapter', () => {
  let mockCreate: jest.Mock;
  let adapter: LemonadeAdapter;

  beforeEach(() => {
    mockCreate = jest.fn();
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }));
    adapter = new LemonadeAdapter('lemonade-model');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('has provider "lemonade"', () => {
    expect(adapter.provider).toBe('lemonade');
  });

  it('uses the model passed to constructor', () => {
    expect(adapter.model).toBe('lemonade-model');
  });

  it('exposes correct default base URL constant', () => {
    expect(LEMONADE_DEFAULT_BASE_URL).toBe('http://localhost:8000/api/v0');
  });

  it('returns text content and overrides provider to "lemonade"', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'Hello from Lemonade!', tool_calls: [] } }],
    });

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(result.content).toBe('Hello from Lemonade!');
    expect(result.provider).toBe('lemonade');
  });
});

// -----------------------------------------------------------------------
// resolveProvider — lmstudio / lemonade detection
// -----------------------------------------------------------------------

import { resolveProvider } from '../../lib/adapterFactory';

describe('resolveProvider local LLM detection', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('returns "lmstudio" when COPILOT_PROVIDER=lmstudio', () => {
    process.env.COPILOT_PROVIDER = 'lmstudio';
    delete process.env.LMSTUDIO_BASE_URL;
    expect(resolveProvider()).toBe('lmstudio');
  });

  it('returns "lemonade" when COPILOT_PROVIDER=lemonade', () => {
    process.env.COPILOT_PROVIDER = 'lemonade';
    delete process.env.LEMONADE_BASE_URL;
    expect(resolveProvider()).toBe('lemonade');
  });

  it('returns "lmstudio" when LMSTUDIO_BASE_URL is set and no API keys are present', () => {
    delete process.env.COPILOT_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LEMONADE_BASE_URL;
    process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234/v1';
    expect(resolveProvider()).toBe('lmstudio');
  });

  it('returns "lemonade" when LEMONADE_BASE_URL is set and no API keys are present', () => {
    delete process.env.COPILOT_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LMSTUDIO_BASE_URL;
    process.env.LEMONADE_BASE_URL = 'http://localhost:8000/api/v0';
    expect(resolveProvider()).toBe('lemonade');
  });
});
