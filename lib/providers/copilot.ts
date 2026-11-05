/**
 * GitHub Copilot via the official @github/copilot-sdk.
 *
 * The SDK runs its own tool loop, so this provider implements `runTurn`: the
 * SDK gets only CopHarness tools (its built-in tools are disabled) and every
 * call is routed back through the harness's permission and hook pipeline.
 */
import type { CopilotClient, CopilotSession, ProviderConfig } from '@github/copilot-sdk';
import { emptyUsage, type Message, type Usage } from '../types';
import type { ModelProvider, ModelRequest } from './types';

type SdkModule = typeof import('@github/copilot-sdk');

let client: CopilotClient | undefined;

function getClient(): CopilotClient {
  if (!client) {
    // Loaded lazily: the SDK ships a native runtime that other providers never need.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('@github/copilot-sdk') as SdkModule;
    client = new sdk.CopilotClient({ env: process.env });
  }
  return client;
}

/** Flatten earlier turns into a transcript; the SDK session starts fresh each turn. */
export function flattenTranscript(messages: Message[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    for (const part of m.content) {
      if (part.type === 'text' && part.text.trim()) lines.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${part.text}`);
      if (part.type === 'tool_call') lines.push(`Assistant called ${part.name}(${JSON.stringify(part.input).slice(0, 500)})`);
      if (part.type === 'tool_result') lines.push(`Tool ${part.name} returned${part.isError ? ' an error' : ''}: ${part.content.slice(0, 2000)}`);
    }
  }
  return lines.join('\n\n');
}

export class CopilotProvider implements ModelProvider {
  readonly kind = 'copilot';

  constructor(private readonly options: { timeoutMs: number }) {}

  async stream(): Promise<never> {
    throw new Error('Copilot provider runs whole turns; use runTurn');
  }

  async runTurn(request: Parameters<NonNullable<ModelProvider['runTurn']>>[0]) {
    const sdkClient = getClient();
    await sdkClient.start();
    const byokKey = process.env.COPILOT_PROVIDER_API_KEY || process.env.COPILOT_API_KEY;
    const byokBase = process.env.COPILOT_PROVIDER_BASE_URL || process.env.COPILOT_API_BASE_URL;
    const provider: ProviderConfig | undefined = byokKey && byokBase ? { type: 'openai', apiKey: byokKey, baseUrl: byokBase } : undefined;

    let session: CopilotSession;
    try {
      session = await sdkClient.createSession({
        model: request.model,
        streaming: true,
        provider,
        systemMessage: { mode: 'replace', content: request.system },
        // Only harness tools are visible; anything else the runtime asks for is denied.
        availableTools: request.tools.map(t => t.name),
        onPermissionRequest: () => ({ kind: 'denied-interactively-by-user' as const }),
        tools: request.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: { ...tool.inputSchema },
          skipPermission: true, // the harness asks for permission itself
          handler: async (args: unknown, invocation: { toolCallId: string }) => {
            const result = await request.executeTool({
              type: 'tool_call',
              id: invocation.toolCallId,
              name: tool.name,
              input: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
            });
            return { textResultForLlm: result.content, resultType: result.isError ? 'failure' as const : 'success' as const };
          },
        })),
        infiniteSessions: { enabled: false },
        memory: { enabled: false },
        enableSessionStore: false,
        enableSkills: false,
        enableConfigDiscovery: false,
        enableFileHooks: false,
        enableOnDemandInstructionDiscovery: false,
        enableHostGitOperations: false,
        largeOutput: { enabled: false },
        skipEmbeddingRetrieval: true,
        embeddingCacheStorage: 'in-memory',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/auth|unauthori|401|forbidden|not authenticated/i.test(msg)) {
        throw new Error('GitHub Copilot の認証に失敗しました。`copilot login` でログインするか、COPILOT_GITHUB_TOKEN / GH_TOKEN を設定してください。');
      }
      throw err;
    }

    let usage: Usage = emptyUsage();
    const unsubscribe = session.on(event => {
      if (event.type === 'assistant.message_delta') request.onEvent({ type: 'text_delta', text: event.data.deltaContent });
      else if (event.type === 'assistant.reasoning_delta') request.onEvent({ type: 'reasoning_delta', text: (event.data as { deltaContent?: string }).deltaContent ?? '' });
      else if (event.type === 'assistant.usage') {
        usage = {
          inputTokens: usage.inputTokens + (event.data.inputTokens ?? 0),
          outputTokens: usage.outputTokens + (event.data.outputTokens ?? 0),
          cacheReadTokens: usage.cacheReadTokens + (event.data.cacheReadTokens ?? 0),
          cacheWriteTokens: usage.cacheWriteTokens + (event.data.cacheWriteTokens ?? 0),
        };
      }
    });
    const onAbort = () => { session.abort().catch(() => {}); };
    request.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const history = request.messages.slice(0, -1);
      const last = request.messages[request.messages.length - 1];
      const lastText = last?.content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n') ?? '';
      const prompt = history.length
        ? `これまでの会話:\n\n${flattenTranscript(history)}\n\n---\n\n${lastText}`
        : lastText;
      const attachments = (last?.content ?? [])
        .filter(p => p.type === 'image')
        .map(p => ({ type: 'blob' as const, data: (p as { data: string }).data, mimeType: (p as { mimeType: string }).mimeType }));
      const response = await session.sendAndWait({ prompt, ...(attachments.length ? { attachments } : {}) }, this.options.timeoutMs);
      if (request.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      return { text: response?.data?.content ?? '', usage, stopReason: 'end_turn' as const };
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
      unsubscribe();
      await session.disconnect().catch(() => {});
    }
  }
}

export async function stopCopilotClient(): Promise<void> {
  if (client) await client.stop().catch(() => {});
  client = undefined;
}

export type { ModelRequest };
