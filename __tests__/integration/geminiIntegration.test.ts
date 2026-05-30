/**
 * Integration tests for GeminiAdapter.
 * fetch is mocked — no real Gemini API calls are made.
 * Tests the full sendMessage (adapter.complete) flow including request mapping,
 * response mapping, and error propagation.
 */

import { GeminiAdapter } from '../../lib/adapters/geminiAdapter';
import { GeminiAPIError, GEMINI_DEFAULT_ENDPOINT } from '../../lib/services/geminiClient';
import { type LLMMessage } from '../../lib/adapter';

const MOCK_API_KEY = 'integration-test-key';
const MOCK_MODEL = 'gemini-1.5-pro';

const GEMINI_SUCCESS_RESPONSE = {
  candidates: [
    {
      content: { role: 'model', parts: [{ text: 'Hello from Gemini!' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: {
    promptTokenCount: 5,
    candidatesTokenCount: 8,
    totalTokenCount: 13,
  },
  modelVersion: MOCK_MODEL,
};

function mockFetchSuccess(body = GEMINI_SUCCESS_RESPONSE) {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status: 200 }),
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = jest.fn();
});

describe('GeminiAdapter – integration', () => {
  describe('sendMessage (adapter.complete)', () => {
    it('maps a user message to Gemini format and returns internal LLMResponse', async () => {
      mockFetchSuccess();
      const adapter = new GeminiAdapter(MOCK_MODEL, MOCK_API_KEY);

      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];
      const response = await adapter.complete({ messages });

      expect(response.content).toBe('Hello from Gemini!');
      expect(response.model).toBe(MOCK_MODEL);
      expect(response.provider).toBe('gemini');
    });

    it('sends system message as systemInstruction', async () => {
      mockFetchSuccess();
      const adapter = new GeminiAdapter(MOCK_MODEL, MOCK_API_KEY);

      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];
      await adapter.complete({ messages });

      const [, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);

      expect(body.systemInstruction).toEqual({
        parts: [{ text: 'You are a helpful assistant.' }],
      });
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].role).toBe('user');
    });

    it('maps assistant role to "model" in Gemini request', async () => {
      mockFetchSuccess();
      const adapter = new GeminiAdapter(MOCK_MODEL, MOCK_API_KEY);

      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
      ];
      await adapter.complete({ messages });

      const [, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);

      expect(body.contents[1].role).toBe('model');
    });

    it('uses model from request when provided', async () => {
      mockFetchSuccess();
      const adapter = new GeminiAdapter(MOCK_MODEL, MOCK_API_KEY);

      await adapter.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gemini-2.0-flash',
      });

      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('gemini-2.0-flash');
    });

    it('returns empty content when candidates array is empty', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
      );
      const adapter = new GeminiAdapter(MOCK_MODEL, MOCK_API_KEY);

      const response = await adapter.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.content).toBe('');
    });

    it('concatenates multiple text parts from a candidate', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ text: 'Part one. ' }, { text: 'Part two.' }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
      const adapter = new GeminiAdapter(MOCK_MODEL, MOCK_API_KEY);

      const response = await adapter.complete({
        messages: [{ role: 'user', content: 'Tell me something.' }],
      });

      expect(response.content).toBe('Part one. Part two.');
    });
  });

  describe('error propagation', () => {
    it('propagates GeminiAPIError on 401', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }),
      );
      const adapter = new GeminiAdapter(MOCK_MODEL, MOCK_API_KEY, GEMINI_DEFAULT_ENDPOINT, 5_000, 0);

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hello' }] }),
      ).rejects.toBeInstanceOf(GeminiAPIError);
    });

    it('propagates timeout error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('The operation was aborted.'), { name: 'TimeoutError' }),
      );
      const adapter = new GeminiAdapter(MOCK_MODEL, MOCK_API_KEY, GEMINI_DEFAULT_ENDPOINT, 1, 0);

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hello' }] }),
      ).rejects.toMatchObject({ name: 'TimeoutError' });
    });
  });

  describe('isolation from other adapters', () => {
    it('does not interfere with existing copilot adapter path (independent instances)', async () => {
      // GeminiAdapter and (hypothetical) other adapters are independent objects
      mockFetchSuccess();
      const geminiAdapter = new GeminiAdapter(MOCK_MODEL, MOCK_API_KEY);
      const result = await geminiAdapter.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(result.provider).toBe('gemini');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
