/**
 * Unit tests for POST /api/line (LINE Bot Webhook)
 */

import crypto from 'crypto';

jest.mock('@line/bot-sdk', () => ({
  validateSignature: jest.fn(),
  messagingApi: {
    MessagingApiClient: jest.fn().mockImplementation(() => ({
      replyMessage: jest.fn().mockResolvedValue({}),
    })),
  },
}));

jest.mock('../../lib/history/store', () => ({
  loadHistory: jest.fn().mockReturnValue([]),
  saveHistory: jest.fn().mockResolvedValue(undefined),
  clearHistory: jest.fn().mockResolvedValue(undefined),
}));

import * as lineBot from '@line/bot-sdk';
import { POST } from '../../app/api/line/route';
import { NextRequest } from 'next/server';

jest.mock('../../lib/adapterFactory', () => ({
  createAdapter: jest.fn(),
  resolveProvider: jest.fn(),
}));

import * as adapterFactory from '../../lib/adapterFactory';
import * as adapterModule from '../../lib/adapter';

const mockComplete = jest.fn();
const mockReplyMessage = jest.fn().mockResolvedValue({});

function makeSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

function makeRequest(body: unknown, signature?: string) {
  const raw = JSON.stringify(body);
  const sig = signature ?? makeSignature(raw, 'test-secret');
  return new NextRequest('http://localhost:3000/api/line', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-line-signature': sig,
    },
    body: raw,
  });
}

function makeTextEvent(overrides: Partial<{
  type: string;
  replyToken: string;
  userId: string;
  text: string;
  messageType: string;
}> = {}) {
  const {
    type = 'message',
    replyToken = 'reply-token-123',
    userId = 'U1234567890',
    text = 'こんにちは',
    messageType = 'text',
  } = overrides;
  return {
    type,
    replyToken,
    source: { type: 'user', userId },
    message: { type: messageType, id: 'msg-1', text },
  };
}

describe('POST /api/line', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LINE_CHANNEL_SECRET: 'test-secret',
      LINE_CHANNEL_ACCESS_TOKEN: 'test-access-token',
      GITHUB_COPILOT_API_KEY: 'test-key',
    };

    mockComplete.mockReset();
    mockComplete.mockResolvedValue({ content: 'こんにちは！何かお手伝いできることはありますか？' });
    mockReplyMessage.mockReset();
    mockReplyMessage.mockResolvedValue({});

    (adapterFactory.createAdapter as jest.Mock).mockReturnValue({
      complete: mockComplete,
      provider: 'copilot',
      model: 'gpt-5-mini',
    } as unknown as adapterModule.LLMAdapter);
    (adapterFactory.resolveProvider as jest.Mock).mockReturnValue('copilot');

    (lineBot.validateSignature as jest.Mock).mockReturnValue(true);
    (lineBot.messagingApi.MessagingApiClient as jest.Mock).mockImplementation(() => ({
      replyMessage: mockReplyMessage,
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('returns 503 when LINE credentials are not configured', async () => {
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const res = await POST(makeRequest({ destination: 'U123', events: [] }));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toMatch(/not configured/);
  });

  it('returns 401 when signature is invalid', async () => {
    (lineBot.validateSignature as jest.Mock).mockReturnValue(false);
    const res = await POST(makeRequest({ destination: 'U123', events: [] }, 'bad-sig'));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/Invalid signature/);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const raw = 'not json';
    const sig = makeSignature(raw, 'test-secret');
    const req = new NextRequest('http://localhost:3000/api/line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-line-signature': sig },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Invalid JSON/);
  });

  it('returns 200 for empty events (webhook verification)', async () => {
    const res = await POST(makeRequest({ destination: 'U123', events: [] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('processes a text message event and calls replyMessage', async () => {
    const body = { destination: 'U123', events: [makeTextEvent()] };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockReplyMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockReplyMessage.mock.calls[0][0];
    expect(callArgs.replyToken).toBe('reply-token-123');
    expect(callArgs.messages[0].type).toBe('text');
    expect(typeof callArgs.messages[0].text).toBe('string');
  });

  it('sends a greeting when a follow event is received', async () => {
    const body = {
      destination: 'U123',
      events: [{ type: 'follow', replyToken: 'follow-reply-token', source: { type: 'user', userId: 'U1' } }],
    };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockReplyMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockReplyMessage.mock.calls[0][0];
    expect(callArgs.replyToken).toBe('follow-reply-token');
    expect(callArgs.messages[0].type).toBe('text');
    expect(typeof callArgs.messages[0].text).toBe('string');
  });

  it('ignores non-message non-follow events (e.g. unfollow)', async () => {
    const body = { destination: 'U123', events: [{ type: 'unfollow', source: { type: 'user', userId: 'U1' } }] };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockReplyMessage).not.toHaveBeenCalled();
  });

  it('ignores non-text message events (e.g. image)', async () => {
    const body = { destination: 'U123', events: [makeTextEvent({ messageType: 'image' })] };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('returns 200 (no LLM key) and does not call replyMessage when no API key', async () => {
    delete process.env.GITHUB_COPILOT_API_KEY;
    delete process.env.COPILOT_PROVIDER_API_KEY;
    delete process.env.COPILOT_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    (adapterFactory.resolveProvider as jest.Mock).mockReturnValue('copilot');

    const body = { destination: 'U123', events: [makeTextEvent()] };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mockReplyMessage).not.toHaveBeenCalled();
  });

  it('replies with error message when LLM throws', async () => {
    mockComplete.mockRejectedValueOnce(new Error('LLM failure'));
    const body = { destination: 'U123', events: [makeTextEvent()] };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mockReplyMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockReplyMessage.mock.calls[0][0];
    expect(callArgs.messages[0].text).toMatch(/エラーが発生しました/);
  });

  it('truncates reply text longer than 5000 characters', async () => {
    const longText = 'A'.repeat(6000);
    mockComplete.mockResolvedValueOnce({ content: longText });
    const body = { destination: 'U123', events: [makeTextEvent()] };
    await POST(makeRequest(body));
    const callArgs = mockReplyMessage.mock.calls[0][0];
    expect(callArgs.messages[0].text.length).toBe(5000);
  });

  it('processes multiple text events in one webhook call', async () => {
    const body = {
      destination: 'U123',
      events: [
        makeTextEvent({ replyToken: 'token-1', userId: 'U001', text: 'Hello' }),
        makeTextEvent({ replyToken: 'token-2', userId: 'U002', text: 'Hi' }),
      ],
    };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(mockReplyMessage).toHaveBeenCalledTimes(2);
  });
});
