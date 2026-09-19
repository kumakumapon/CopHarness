import * as fs from 'fs';
import { randomUUID, createHash } from 'crypto';
import { dataPath } from '../utils/dataDir';
import type { LLMMessage } from '../adapter';
import type { SkillResult } from '../skill';
import { runAgentLoop, type AgentLoopOptions, type AgentLoopResult, type AgentStopReason } from './agentLoop';

interface ToolReceipt {
  name: string;
  fingerprint: string;
  args: Record<string, unknown>;
  state: 'started' | 'finished';
  replay: 'reuse' | 'repeat';
  result?: SkillResult;
}
export interface AgentSession {
  version: 1;
  id: string;
  owner: string;
  goal: string;
  provider: string;
  model: string;
  status: AgentStopReason | 'running';
  messages: LLMMessage[];
  tools: ToolReceipt[];
  updatedAt: string;
  pendingQuestion?: string;
  result?: Omit<AgentLoopResult, 'messages'>;
}
export class SessionError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); }
}
function sessionPath(id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new SessionError('Invalid session ID', 400);
  return dataPath('agent-sessions', `${id}.json`);
}
export function loadAgentSession(id: string): AgentSession | undefined {
  const file = sessionPath(id);
  if (!fs.existsSync(file)) return undefined;
  const session = JSON.parse(fs.readFileSync(file, 'utf8')) as AgentSession;
  if (session.version !== 1 || session.id !== id || !Array.isArray(session.messages) || !Array.isArray(session.tools)) {
    throw new SessionError('Invalid agent checkpoint');
  }
  return session;
}
function save(session: AgentSession): void {
  session.updatedAt = new Date().toISOString();
  const file = sessionPath(session.id);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(session), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function newAgentSessionId(): string { return `agent_${randomUUID()}`; }
export function listAgentSessions(owner: string): AgentSession[] {
  const dir = dataPath('agent-sessions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => {
    try { const s = loadAgentSession(f.slice(0, -5)); return s?.owner === owner ? [s] : []; }
    catch { return []; }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
/** File lease prevents concurrent writers across CLI/server processes on one host.
 * Stale leases are intentionally not stolen: after a crash, verify the process is
 * stopped before removing its .lock file. No side effect is automatically retried.
 */
export function acquireAgentSession(id: string): () => void {
  const lock = `${sessionPath(id)}.lock`;
  try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new SessionError('Session is locked; verify the previous process has stopped before removing its .lock file');
    throw err;
  }
  return () => fs.unlinkSync(lock);
}
export function validateResume(session: AgentSession, owner: string, answer?: string): void {
  if (session.owner !== owner) throw new SessionError('Session not found', 404);
  if (session.status === 'succeeded') throw new SessionError('Session already succeeded');
  if (session.tools.some(t => t.replay === 'reuse' && (t.state === 'started' || t.result?.isError))) {
    throw new SessionError('A side effect has an uncertain outcome. Reconcile the saved tool receipts before starting a new task; automatic resume is blocked.');
  }
  if (session.pendingQuestion && !answer?.trim()) throw new SessionError('answer is required for the pending question', 400);
}
export async function runAgentSession(options: AgentLoopOptions & {
  sessionId: string;
  owner: string;
  resume?: boolean;
  answer?: string;
}): Promise<AgentLoopResult & { sessionId: string }> {
  const existing = loadAgentSession(options.sessionId);
  if (options.resume && !existing) throw new SessionError('Session not found', 404);
  if (!options.resume && existing) throw new SessionError('Session already exists');
  if (existing) validateResume(existing, options.owner, options.answer);
  const session: AgentSession = existing ?? {
    version: 1, id: options.sessionId, owner: options.owner, goal: options.goal,
    provider: options.adapter.provider, model: options.adapter.model, status: 'running',
    messages: options.messages?.map(m => ({ ...m })) ?? [], tools: [], updatedAt: '',
  };
  if (existing && options.answer?.trim()) {
    session.messages.push({ role: 'user', content: `Answer to ${session.pendingQuestion ?? 'continuation'}: ${options.answer}` });
    session.pendingQuestion = undefined;
  }
  if (existing) session.messages.push({ role: 'assistant', content: '[SAVED TOOL RECEIPTS] ' + JSON.stringify(session.tools.filter(t => t.replay === 'reuse').slice(-20)) });
  if (existing) session.messages.push({ role: 'user', content: 'Resume the saved goal using the recorded results. Do not repeat completed side effects.' });
  session.status = 'running';
  session.provider = options.adapter.provider;
  session.model = options.adapter.model;
  save(session);
  let storageError: unknown;
  const persist = () => { try { save(session); } catch (err) { storageError = err; throw err; } };
  const skills = (options.skills ?? []).map(skill => ({
    ...skill,
    handler: async (args: Record<string, unknown>) => {
      if (storageError) throw new Error('Checkpoint storage failed; tools disabled');
      const fingerprint = createHash('sha256').update(canonical({ name: skill.name, args })).digest('hex');
      const prior = session.tools.find(t => t.fingerprint === fingerprint && t.replay === 'reuse');
      if (prior) return prior.state === 'finished' && prior.result
        ? prior.result : { content: 'Previous side effect outcome is unknown; execution blocked.', isError: true };
      // Unknown risk is conservative. Low-risk tools may be repeated.
      const receipt: ToolReceipt = { name: skill.name, args, fingerprint, state: 'started', replay: skill.riskLevel === 'low' ? 'repeat' : 'reuse' };
      session.tools.push(receipt);
      persist(); // durable intent before the handler may produce a side effect
      let result: SkillResult;
      try { result = await skill.handler(args); }
      catch (err) { result = { content: err instanceof Error ? err.message : String(err), isError: true }; }
      receipt.state = 'finished'; receipt.result = result;
      persist(); // persist before returning the result to the model
      return result;
    },
  }));
  const result = await runAgentLoop({ ...options, goal: session.goal, skills,
    messages: session.messages,
    onCheckpoint(messages) { session.messages = messages; persist(); options.onCheckpoint?.(messages); },
  });
  if (storageError) throw storageError;
  session.status = result.stopReason;
  session.pendingQuestion = result.pendingQuestion;
  session.messages = result.messages;
  const { messages: _messages, ...summary } = result;
  session.result = summary;
  persist();
  return { ...result, sessionId: session.id };
}
