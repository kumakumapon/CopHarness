/**
 * Jest stand-in for @github/copilot-sdk (mapped in jest.config.js).
 *
 * The type imports below resolve to the REAL SDK types (moduleNameMapper only affects the jest runtime),
 * and the compile-time assertions at the bottom fail `tsc` when the SDK's session/client API drifts away
 * from what this mock — and therefore the tests — assume (e.g. `destroy()` becoming `disconnect()`).
 */
import type {
  AssistantMessageEvent,
  CopilotClient as RealCopilotClient,
  CopilotSession as RealCopilotSession,
  MessageOptions,
} from '@github/copilot-sdk';

type SendAndWait = (options: MessageOptions, timeout?: number) => Promise<AssistantMessageEvent | undefined>;

export interface MockSession {
  sendAndWait: jest.Mock<ReturnType<SendAndWait>, Parameters<SendAndWait>>;
  disconnect: jest.Mock<Promise<void>, []>;
}

/** Observable state for tests; reset with `mockCopilotSdk.reset()`. */
export const mockCopilotSdk = {
  sessions: [] as MockSession[],
  createSessionConfigs: [] as unknown[],
  /** Reply every new session's sendAndWait gives (replaced per test). */
  reply: (_options: MessageOptions): Promise<AssistantMessageEvent | undefined> =>
    Promise.resolve({ data: { content: '' } } as unknown as AssistantMessageEvent),
  reset(): void {
    this.sessions = [];
    this.createSessionConfigs = [];
    this.reply = () => Promise.resolve({ data: { content: '' } } as unknown as AssistantMessageEvent);
  },
};

export class CopilotClient implements Pick<RealCopilotClient, 'start' | 'stop'> {
  constructor(_options?: unknown) {}
  async start(): Promise<void> {}
  async stop(): Promise<Error[]> {
    return [];
  }
  async createSession(config?: unknown): Promise<MockSession> {
    mockCopilotSdk.createSessionConfigs.push(config);
    const session: MockSession = {
      sendAndWait: jest.fn((options: MessageOptions) => mockCopilotSdk.reply(options)),
      disconnect: jest.fn(async () => {}),
    };
    mockCopilotSdk.sessions.push(session);
    return session;
  }
}

export const approveAll = () => ({ kind: 'approve-once' });

// ── Compile-time contract checks against the real SDK ───────────────────────
type Assert<T extends true> = T;
// The real session must still offer what the mock (and CopilotAdapter) rely on.
export type SessionDisconnects = Assert<RealCopilotSession['disconnect'] extends () => Promise<void> ? true : false>;
export type SessionSendAndWaits = Assert<RealCopilotSession['sendAndWait'] extends SendAndWait ? true : false>;
export type ClientHasCreateSession = Assert<RealCopilotClient['createSession'] extends (config: never) => Promise<RealCopilotSession> ? true : false>;
