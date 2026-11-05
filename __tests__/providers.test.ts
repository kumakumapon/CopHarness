import { AnthropicProvider, supportsAdaptiveThinking, toAnthropicMessages } from '../lib/providers/anthropic';
import { toGeminiContents } from '../lib/providers/gemini';
import { toOpenAIMessages } from '../lib/providers/openai';
import { flattenTranscript } from '../lib/providers/copilot';
import { isTransientError, withRetry, type ModelProvider } from '../lib/providers/types';
import type { Message } from '../lib/types';

const conversation: Message[] = [
  { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }, { type: 'text', text: 'look' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'checking' }, { type: 'tool_call', id: 't1', name: 'read_file', input: { path: 'a' } }] },
  { role: 'user', content: [{ type: 'tool_result', toolCallId: 't1', name: 'read_file', content: 'data', isError: true }] },
  { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
];

describe('Anthropic', () => {
  it('replays native assistant content verbatim and converts the rest', () => {
    const native = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'done', citations: null }];
    const messages = toAnthropicMessages([...conversation.slice(0, 3), { ...conversation[3], native: { provider: 'anthropic', content: native } }]);
    expect(messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'look' },
    ]);
    expect(messages[1].content).toContainEqual({ type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a' } });
    expect(messages[2].content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'data', is_error: true }]);
    expect(messages[3].content).toBe(native);
  });

  it('builds cached, adaptive-thinking requests with server-side fallback for current models', () => {
    const p = new AnthropicProvider({ apiKey: 'k', timeoutMs: 1000 });
    const params = p.buildParams({ model: 'claude-opus-5-5', system: 'sys', messages: conversation, tools: [{ name: 'x', description: 'd', inputSchema: { type: 'object' } }] }) as unknown as Record<string, unknown>;
    expect(params.cache_control).toEqual({ type: 'ephemeral' });
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(params.output_config).toEqual({ effort: 'high' });
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.max_tokens).toBe(64000);
    expect((params.tools as Array<Record<string, unknown>>)[0]).toMatchObject({ name: 'x', eager_input_streaming: true });
    expect(params).not.toHaveProperty('temperature');
  });

  it('keeps older models on the plain request shape', () => {
    const p = new AnthropicProvider({ apiKey: 'k', timeoutMs: 1000, baseUrl: 'http://proxy' });
    const params = p.buildParams({ model: 'claude-haiku-4-5', system: '', messages: conversation, tools: [] }) as unknown as Record<string, unknown>;
    expect(params.thinking).toBeUndefined();
    expect(params.fallbacks).toBeUndefined();
    expect(params.system).toBeUndefined();
    expect(supportsAdaptiveThinking('claude-sonnet-4-6')).toBe(true);
    expect(supportsAdaptiveThinking('claude-haiku-4-5')).toBe(false);
  });
});

describe('OpenAI-compatible', () => {
  it('maps tool calls and results to chat completion messages', () => {
    const messages = toOpenAIMessages('sys', conversation);
    expect(messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(messages[1]).toMatchObject({ role: 'user', content: [{ type: 'image_url' }, { type: 'text', text: 'look' }] });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'checking', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] });
    expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'data' });
    expect(messages[4]).toEqual({ role: 'assistant', content: 'done' });
  });
});

describe('Gemini', () => {
  it('maps to contents with function calls and responses', () => {
    const contents = toGeminiContents(conversation);
    expect(contents[1].role).toBe('model');
    expect(contents[1].parts?.[1]).toMatchObject({ functionCall: { name: 'read_file', id: 't1' }, thoughtSignature: 'skip_thought_signature_validator' });
    expect(contents[2].parts?.[0]).toEqual({ functionResponse: { name: 'read_file', id: 't1', response: { error: 'data' } } });
    const native = toGeminiContents([{ role: 'assistant', content: [], native: { provider: 'gemini', content: [{ text: 'x', thoughtSignature: 'abc' }] } }]);
    expect(native[0].parts).toEqual([{ text: 'x', thoughtSignature: 'abc' }]);
  });
});

describe('Copilot', () => {
  it('flattens history for the SDK session', () => {
    const text = flattenTranscript(conversation);
    expect(text).toContain('User: look');
    expect(text).toContain('Assistant called read_file');
    expect(text).toContain('Tool read_file returned an error: data');
  });
});

describe('retries', () => {
  it('classifies transient errors', () => {
    expect(isTransientError({ status: 529 })).toBe(true);
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false);
  });

  it('retries before any output, never after', async () => {
    let calls = 0;
    const flaky: ModelProvider = {
      kind: 'openai',
      async stream(_req, onEvent) {
        calls++;
        if (calls === 1) throw Object.assign(new Error('overloaded'), { status: 503 });
        onEvent({ type: 'text_delta', text: 'hi' });
        if (calls === 2) throw Object.assign(new Error('mid-stream'), { status: 503 });
        return { message: { role: 'assistant', content: [] }, stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
      },
    };
    jest.useFakeTimers({ advanceTimers: true });
    await expect(withRetry(flaky).stream({ model: 'm', system: '', messages: [], tools: [] }, () => {})).rejects.toThrow('mid-stream');
    jest.useRealTimers();
    expect(calls).toBe(2);
  });
});
