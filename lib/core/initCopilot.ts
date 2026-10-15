import type { SkillDefinition } from './skill';
import { isMinimalRuntime } from './runtimeProfile';
import type { CopilotClient as SdkCopilotClient, CopilotSession, ProviderConfig } from '@github/copilot-sdk';

// The SDK types are the contract: everything below (and lib/core/adapters/copilotAdapter.ts) is type-checked
// against them, so an SDK API change fails `tsc` instead of surfacing only against the real service.
type SdkModule = typeof import('@github/copilot-sdk');

let CopilotClient: SdkModule['CopilotClient'];
let approveAll: SdkModule['approveAll'];
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require('@github/copilot-sdk') as SdkModule & { default?: SdkModule };
  CopilotClient = sdk.CopilotClient || sdk.default?.CopilotClient!;
  approveAll = sdk.approveAll || sdk.default?.approveAll!;
} catch {
  // SDK not installed (e.g. optional platform package missing): fail on first use, not at import time.
  CopilotClient = class {
    constructor() {
      throw new Error('@github/copilot-sdk could not be loaded');
    }
  } as unknown as SdkModule['CopilotClient'];
  approveAll = (() => ({ kind: 'approve-once' })) as unknown as SdkModule['approveAll'];
}

const BYOK_API_KEY = process.env.COPILOT_PROVIDER_API_KEY || process.env.COPILOT_API_KEY;
const BYOK_BASE = process.env.COPILOT_PROVIDER_BASE_URL || process.env.COPILOT_API_BASE_URL;
const MODEL = process.env.COPILOT_MODEL ?? 'gpt-5-mini';

export const copilotClient: SdkCopilotClient = new CopilotClient({
  env: process.env,
});

export async function startClient() {
  // SDK 1.x: start() is idempotent (and there is no getState()).
  await copilotClient.start();
}

export async function stopClient() {
  try {
    await copilotClient.stop();
  } catch (e) {}
}

export async function createSession(opts?: { model?: string; streaming?: boolean; skills?: SkillDefinition[] }): Promise<CopilotSession> {
  const model = opts?.model ?? MODEL;
  const provider: ProviderConfig | undefined = BYOK_API_KEY && BYOK_BASE ? {
    type: 'openai',
    apiKey: BYOK_API_KEY,
    baseUrl: BYOK_BASE,
  } : undefined;
  await startClient();
  try {
    const session = await copilotClient.createSession({
      onPermissionRequest: isMinimalRuntime() ? () => ({ kind: 'denied-interactively-by-user' as const }) : approveAll,
      ...(isMinimalRuntime() ? {
        availableTools: (opts?.skills ?? []).map(skill => skill.name),
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
        tools: (opts?.skills ?? []).map(skill => ({
          name: skill.name, description: skill.description, parameters: { ...skill.parameters },
          // Permissions are handled by the harness gate, never by SDK auto-approval.
          skipPermission: true,
          // The harness handler retains validation, tool policy and approval checks.
          handler: async (args: Record<string, unknown>) => {
            const result = await skill.handler(args);
            return { textResultForLlm: result.content, resultType: result.isError ? 'failure' as const : 'success' as const };
          },
        })),
      } : {}),
      model,
      streaming: opts?.streaming ?? true,
      provider,
    });
    return session;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/auth|unauthori|401|forbidden|not authenticated/i.test(msg)) {
      throw new Error(
        'Authentication failed when creating Copilot session. Ensure one of: (1) You are logged in with `copilot login` on this machine, (2) Set COPILOT_GITHUB_TOKEN/GH_TOKEN/GITHUB_TOKEN, or (3) Configure BYOK with COPILOT_PROVIDER_API_KEY and COPILOT_PROVIDER_BASE_URL.'
      );
    }
    throw err;
  }
}
