/**
 * Unit tests for the TokenUsage interface from lib/adapter.ts.
 *
 * These tests verify that mock LLMResponse objects with a `usage` field
 * are correctly typed and that all three token count properties are accessible.
 */

import type { LLMResponse, TokenUsage } from '../../lib/adapter';

describe('TokenUsage interface', () => {
  it('allows all three token count properties to be set', () => {
    const usage: TokenUsage = {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    };
    expect(usage.promptTokens).toBe(10);
    expect(usage.completionTokens).toBe(20);
    expect(usage.totalTokens).toBe(30);
  });

  it('allows partial TokenUsage (all fields are optional)', () => {
    const usage: TokenUsage = { promptTokens: 5 };
    expect(usage.promptTokens).toBe(5);
    expect(usage.completionTokens).toBeUndefined();
    expect(usage.totalTokens).toBeUndefined();
  });

  it('allows empty TokenUsage object', () => {
    const usage: TokenUsage = {};
    expect(usage.promptTokens).toBeUndefined();
    expect(usage.completionTokens).toBeUndefined();
    expect(usage.totalTokens).toBeUndefined();
  });
});

describe('LLMResponse with usage field', () => {
  it('can carry a full usage object', () => {
    const response: LLMResponse = {
      content: 'Hello!',
      model: 'gpt-4',
      provider: 'openai',
      usage: {
        promptTokens: 15,
        completionTokens: 25,
        totalTokens: 40,
      },
    };
    expect(response.content).toBe('Hello!');
    expect(response.usage).toBeDefined();
    expect(response.usage!.promptTokens).toBe(15);
    expect(response.usage!.completionTokens).toBe(25);
    expect(response.usage!.totalTokens).toBe(40);
  });

  it('usage field is optional on LLMResponse', () => {
    const response: LLMResponse = { content: 'No usage info' };
    expect(response.usage).toBeUndefined();
  });

  it('totalTokens equals promptTokens + completionTokens when both are present', () => {
    const usage: TokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };
    const response: LLMResponse = { content: 'result', usage };
    const { promptTokens = 0, completionTokens = 0, totalTokens = 0 } = response.usage!;
    expect(totalTokens).toBe(promptTokens + completionTokens);
  });

  it('mock adapter response retains usage through assignment', () => {
    const mockAdapterResponse: LLMResponse = {
      content: 'mock response',
      provider: 'anthropic',
      model: 'claude-3',
      usage: { promptTokens: 200, completionTokens: 300, totalTokens: 500 },
    };

    // Simulate what a consumer would do with the response
    const { usage } = mockAdapterResponse;
    expect(usage?.promptTokens).toBe(200);
    expect(usage?.completionTokens).toBe(300);
    expect(usage?.totalTokens).toBe(500);
  });
});
