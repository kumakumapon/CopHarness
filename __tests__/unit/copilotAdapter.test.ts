import type { AssistantMessageEvent } from '@github/copilot-sdk';
import { CopilotAdapter } from '../../lib/core/adapters/copilotAdapter';
// '@github/copilot-sdk' is mapped to __mocks__/copilot-sdk.ts (see jest.config.js); the mock's types are
// checked against the real SDK by `tsc`, so API drift fails the typecheck rather than slipping past these tests.
import { mockCopilotSdk } from '../../__mocks__/copilot-sdk';

const reply = (content: string) =>
  Promise.resolve({ data: { content } } as unknown as AssistantMessageEvent);

describe('CopilotAdapter session lifecycle', () => {
  beforeEach(() => {
    mockCopilotSdk.reset();
  });

  it('sends the conversation as one prompt and returns the reply content', async () => {
    mockCopilotSdk.reply = () => reply('pong');
    const adapter = new CopilotAdapter('gpt-5-mini');

    const result = await adapter.complete({
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'ping' },
      ],
    });

    expect(result).toEqual({ content: 'pong', model: 'gpt-5-mini', provider: 'copilot' });
    const [session] = mockCopilotSdk.sessions;
    expect(session.sendAndWait).toHaveBeenCalledTimes(1);
    const [options, timeout] = session.sendAndWait.mock.calls[0];
    expect(options.prompt).toBe('System: be brief\n\nUser: ping');
    expect(timeout).toBe(30_000);
  });

  it('forwards attachments to the SDK', async () => {
    mockCopilotSdk.reply = () => reply('ok');
    const attachment = { type: 'blob' as const, data: 'AAAA', mimeType: 'image/png' };
    await new CopilotAdapter('m').complete({ messages: [{ role: 'user', content: 'see' }], attachments: [attachment] });
    expect(mockCopilotSdk.sessions[0].sendAndWait.mock.calls[0][0].attachments).toEqual([attachment]);
  });

  it('creates a non-streaming session for the requested model', async () => {
    mockCopilotSdk.reply = () => reply('ok');
    await new CopilotAdapter('default-model').complete({ model: 'other-model', messages: [{ role: 'user', content: 'x' }] });
    expect(mockCopilotSdk.createSessionConfigs[0]).toMatchObject({ model: 'other-model', streaming: false });
  });

  it('disconnects the session after a successful reply', async () => {
    mockCopilotSdk.reply = () => reply('done');
    await new CopilotAdapter('m').complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(mockCopilotSdk.sessions).toHaveLength(1);
    expect(mockCopilotSdk.sessions[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects the session when the request fails, and rethrows the error', async () => {
    mockCopilotSdk.reply = () => Promise.reject(new Error('upstream failed'));
    await expect(new CopilotAdapter('m').complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow('upstream failed');
    expect(mockCopilotSdk.sessions[0].disconnect).toHaveBeenCalled();
  });

  it('disconnects the session and rejects with AbortError when aborted mid-request', async () => {
    mockCopilotSdk.reply = () => new Promise<never>(() => undefined); // never answers
    const controller = new AbortController();
    const pending = new CopilotAdapter('m').complete({ messages: [{ role: 'user', content: 'x' }], abortSignal: controller.signal });
    // let the session be created and the request start before aborting
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockCopilotSdk.sessions[0].disconnect).toHaveBeenCalled();
  });

  it('rejects immediately with AbortError when the signal is already aborted', async () => {
    mockCopilotSdk.reply = () => new Promise<never>(() => undefined);
    const controller = new AbortController();
    controller.abort();
    await expect(
      new CopilotAdapter('m').complete({ messages: [{ role: 'user', content: 'x' }], abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockCopilotSdk.sessions[0].disconnect).toHaveBeenCalled();
  });

  it('streams the full reply as a single chunk', async () => {
    mockCopilotSdk.reply = () => reply('whole');
    const chunks: string[] = [];
    for await (const chunk of new CopilotAdapter('m').stream({ messages: [{ role: 'user', content: 'x' }] })) chunks.push(chunk);
    expect(chunks).toEqual(['whole']);
  });
});
