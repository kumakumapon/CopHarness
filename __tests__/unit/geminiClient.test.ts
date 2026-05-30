/**
 * Unit tests for GeminiClient.
 * fetch is mocked globally — no real network calls are made.
 */

import {
  GeminiClient,
  GeminiAPIError,
  GEMINI_DEFAULT_ENDPOINT,
  type GeminiRequestPayload,
} from '../../lib/services/geminiClient';

const MOCK_API_KEY = 'test-api-key';
const MOCK_MODEL = 'gemini-1.5-pro';

const MOCK_PAYLOAD: GeminiRequestPayload = {
  contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
};

const SUCCESS_BODY = {
  candidates: [
    {
      content: { role: 'model', parts: [{ text: 'Hi there!' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: {
    promptTokenCount: 5,
    candidatesTokenCount: 10,
    totalTokenCount: 15,
  },
  modelVersion: MOCK_MODEL,
};

function mockFetch(status: number, body: unknown, delayMs = 0) {
  const responseInit: ResponseInit = { status };
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  (global.fetch as jest.Mock).mockImplementation(async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return new Response(bodyStr, responseInit);
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = jest.fn();
});

describe('GeminiClient', () => {
  describe('successful requests', () => {
    it('calls the correct URL with model and sends api key as header', async () => {
      mockFetch(200, SUCCESS_BODY);
      const client = new GeminiClient(MOCK_API_KEY);
      await client.request(MOCK_MODEL, MOCK_PAYLOAD);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/models/${MOCK_MODEL}:generateContent`);
      expect(url).not.toContain(`key=`);
      expect((options.headers as Record<string, string>)['x-goog-api-key']).toBe(MOCK_API_KEY);
    });

    it('uses custom endpoint when provided', async () => {
      mockFetch(200, SUCCESS_BODY);
      const client = new GeminiClient(MOCK_API_KEY, 'https://custom.example.com/api');
      await client.request(MOCK_MODEL, MOCK_PAYLOAD);

      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('custom.example.com');
    });

    it('returns parsed response on 200', async () => {
      mockFetch(200, SUCCESS_BODY);
      const client = new GeminiClient(MOCK_API_KEY);
      const result = await client.request(MOCK_MODEL, MOCK_PAYLOAD);

      expect(result).toMatchObject({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Hi there!' }] },
          },
        ],
      });
    });

    it('sends Content-Type: application/json and x-goog-api-key header', async () => {
      mockFetch(200, SUCCESS_BODY);
      const client = new GeminiClient(MOCK_API_KEY);
      await client.request(MOCK_MODEL, MOCK_PAYLOAD);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
      expect((options.headers as Record<string, string>)['x-goog-api-key']).toBe(MOCK_API_KEY);
    });
  });

  describe('error handling', () => {
    it('throws GeminiAPIError with status 400 on bad request', async () => {
      mockFetch(400, JSON.stringify({ error: { message: 'Bad request' } }));
      const client = new GeminiClient(MOCK_API_KEY, GEMINI_DEFAULT_ENDPOINT, 5_000, 0);

      await expect(client.request(MOCK_MODEL, MOCK_PAYLOAD)).rejects.toMatchObject({
        name: 'GeminiAPIError',
        status: 400,
      });
    });

    it('throws GeminiAPIError with status 401 on auth failure', async () => {
      mockFetch(401, JSON.stringify({ error: { message: 'API key not valid' } }));
      const client = new GeminiClient(MOCK_API_KEY, GEMINI_DEFAULT_ENDPOINT, 5_000, 0);

      await expect(client.request(MOCK_MODEL, MOCK_PAYLOAD)).rejects.toBeInstanceOf(
        GeminiAPIError,
      );
      await expect(client.request(MOCK_MODEL, MOCK_PAYLOAD)).rejects.toMatchObject({
        status: 401,
      });
    });

    it('throws GeminiAPIError with status 500 immediately (no retry configured)', async () => {
      mockFetch(500, JSON.stringify({ error: { message: 'Internal error' } }));
      const client = new GeminiClient(MOCK_API_KEY, GEMINI_DEFAULT_ENDPOINT, 5_000, 0);

      await expect(client.request(MOCK_MODEL, MOCK_PAYLOAD)).rejects.toMatchObject({
        name: 'GeminiAPIError',
        status: 500,
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('timeout', () => {
    it('throws a TimeoutError when AbortSignal fires', async () => {
      // Simulate AbortError (what fetch throws on AbortSignal.timeout)
      (global.fetch as jest.Mock).mockRejectedValue(
        Object.assign(new Error('The operation was aborted.'), { name: 'TimeoutError' }),
      );
      const client = new GeminiClient(MOCK_API_KEY, GEMINI_DEFAULT_ENDPOINT, 1, 0);

      await expect(client.request(MOCK_MODEL, MOCK_PAYLOAD)).rejects.toMatchObject({
        name: 'TimeoutError',
      });
    });
  });

  describe('retry logic', () => {
    it('retries on 500 up to retryMax times and eventually succeeds', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'err' }), { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'err' }), { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(SUCCESS_BODY), { status: 200 }));

      // retryMax=2 → up to 3 attempts total (initial + 2 retries)
      const client = new GeminiClient(MOCK_API_KEY, GEMINI_DEFAULT_ENDPOINT, 5_000, 2);
      // Override sleep to avoid actual waiting in tests
      jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any; });

      const result = await client.request(MOCK_MODEL, MOCK_PAYLOAD);

      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(result.candidates[0].content.parts[0].text).toBe('Hi there!');

      jest.restoreAllMocks();
    });

    it('retries on 429 and throws GeminiAPIError after exhausting retries', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
      );
      jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any; });

      // retryMax=2 → 3 attempts
      const client = new GeminiClient(MOCK_API_KEY, GEMINI_DEFAULT_ENDPOINT, 5_000, 2);

      await expect(client.request(MOCK_MODEL, MOCK_PAYLOAD)).rejects.toMatchObject({
        name: 'GeminiAPIError',
        status: 429,
      });
      expect(global.fetch).toHaveBeenCalledTimes(3);

      jest.restoreAllMocks();
    });

    it('does not retry on 4xx client errors (except 429)', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        new Response(JSON.stringify({ error: 'bad' }), { status: 403 }),
      );

      const client = new GeminiClient(MOCK_API_KEY, GEMINI_DEFAULT_ENDPOINT, 5_000, 3);

      await expect(client.request(MOCK_MODEL, MOCK_PAYLOAD)).rejects.toMatchObject({
        status: 403,
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
