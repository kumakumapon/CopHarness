
let CopilotClient: any, approveAll: any;
try {
  const sdk = require('@github/copilot-sdk');
  CopilotClient = sdk.CopilotClient || (sdk.default && sdk.default.CopilotClient);
  approveAll = sdk.approveAll || (sdk.default && sdk.default.approveAll);
} catch {
  CopilotClient = class {};
  approveAll = () => {};
}

const GITHUB_TOKEN = process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const BYOK_API_KEY = process.env.COPILOT_PROVIDER_API_KEY || process.env.COPILOT_API_KEY;
const BYOK_BASE = process.env.COPILOT_PROVIDER_BASE_URL || process.env.COPILOT_API_BASE_URL;
const MODEL = process.env.COPILOT_MODEL ?? 'gpt-5-mini';

export const copilotClient = new CopilotClient({
  autoStart: false,
  env: process.env,
});

export async function startClient() {
  const state = (copilotClient as any).getState?.();
  if (state === 'connected') return;
  await copilotClient.start();
}

export async function stopClient() {
  try {
    await copilotClient.stop();
  } catch (e) {}
}

export async function createSession(opts?: { model?: string; streaming?: boolean }) {
  const model = opts?.model ?? MODEL;
  const provider: any = BYOK_API_KEY && BYOK_BASE ? {
    type: 'openai',
    apiKey: BYOK_API_KEY,
    baseUrl: BYOK_BASE,
  } : undefined;
  await startClient();
  try {
    const session = await copilotClient.createSession({
      onPermissionRequest: approveAll,
      model,
      streaming: opts?.streaming ?? true,
      provider,
    });
    return session;
  } catch (err: any) {
    const msg = err?.message?.toString?.() ?? String(err);
    if (/auth|unauthori|401|forbidden|not authenticated/i.test(msg)) {
      throw new Error(
        'Authentication failed when creating Copilot session. Ensure one of: (1) You are logged in with `copilot login` on this machine, (2) Set COPILOT_GITHUB_TOKEN/GH_TOKEN/GITHUB_TOKEN, or (3) Configure BYOK with COPILOT_PROVIDER_API_KEY and COPILOT_PROVIDER_BASE_URL.'
      );
    }
    throw err;
  }
}
