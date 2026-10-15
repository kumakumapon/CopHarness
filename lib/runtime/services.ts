/** Optional services are loaded only when the full profile actually uses them. */
import { randomUUID } from 'crypto';
import { isMinimalRuntime } from '../core/runtimeProfile';
import { runAgentLoop } from '../core/agents/agentLoop';
import type { AgentLoopOptions } from '../core/agents/agentLoop';
import type * as Tasks from '../extensions/tasks/ledger';
import type * as Sessions from '../extensions/agents/sessions';
import type * as Conversations from '../extensions/conversations/conversationPersistence';
import type * as Ralph from '../extensions/agents/ralphLoop';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tasks = (): typeof Tasks => require('../extensions/tasks/ledger');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sessions = (): typeof Sessions => require('../extensions/agents/sessions');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const conversations = (): typeof Conversations => require('../extensions/conversations/conversationPersistence');

export async function resolveConversationKey(channel: string, subject: string, options: { displayName?: string } = {}) {
  if (!isMinimalRuntime()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store: typeof import('../extensions/channels/identity/store') = require('../extensions/channels/identity/store');
    return store.resolveConversationKey(channel, subject, options);
  }
  const channelKey = `${channel}:${subject}`;
  // Stable only within this identity namespace; no cross-channel linking or file access.
  return { personId: channelKey, channelKey, conversationKey: channelKey };
}

export const startTask: typeof Tasks.startTask = async input => {
  if (!isMinimalRuntime()) return tasks().startTask(input);
  const now = new Date().toISOString();
  return { ...input, id: input.id || `task_${randomUUID()}`, status: 'running', createdAt: now, updatedAt: now, startedAt: now };
};
export const finishTask: typeof Tasks.finishTask = async (...args) => isMinimalRuntime() ? undefined : tasks().finishTask(...args);
export const updateTaskMetadata: typeof Tasks.updateTaskMetadata = async (...args) => isMinimalRuntime() ? undefined : tasks().updateTaskMetadata(...args);

// Keep the same error contract in both profiles without loading the persistent session service.
export { SessionError } from '../core/agents/sessionError';
import { SessionError } from '../core/agents/sessionError';
export const newAgentSessionId = () => `agent_${randomUUID()}`;
export const acquireAgentSession: typeof Sessions.acquireAgentSession = id => isMinimalRuntime() ? () => {} : sessions().acquireAgentSession(id);
export const loadAgentSession: typeof Sessions.loadAgentSession = id => isMinimalRuntime() ? undefined : sessions().loadAgentSession(id);
export const listAgentSessions: typeof Sessions.listAgentSessions = owner => isMinimalRuntime() ? [] : sessions().listAgentSessions(owner);
export const validateResume: typeof Sessions.validateResume = (...args) => {
  if (isMinimalRuntime()) throw new SessionError('Session resume is disabled in the minimal profile', 400);
  return sessions().validateResume(...args);
};
export async function runAgentSession(options: AgentLoopOptions & { sessionId: string; owner: string; resume?: boolean; answer?: string }) {
  if (!isMinimalRuntime()) return sessions().runAgentSession(options);
  if (options.resume) throw new SessionError('Session resume is disabled in the minimal profile', 400);
  return runAgentLoop({ ...options, onCheckpoint: undefined });
}

export const runWithRalphLoop: typeof Ralph.runWithRalphLoop = (request, adapter, options) => {
  if (isMinimalRuntime()) return adapter.complete(request);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ralph: typeof Ralph = require('../extensions/agents/ralphLoop');
  return ralph.runWithRalphLoop(request, adapter, options);
};

export const saveConversation: typeof Conversations.saveConversation = (...args) => {
  if (isMinimalRuntime()) throw new Error('Conversation persistence is disabled in the minimal profile');
  return conversations().saveConversation(...args);
};
export const loadConversation: typeof Conversations.loadConversation = id => isMinimalRuntime() ? null : conversations().loadConversation(id);
export const listConversations: typeof Conversations.listConversations = () => isMinimalRuntime() ? [] : conversations().listConversations();
export const deleteConversation: typeof Conversations.deleteConversation = id => isMinimalRuntime() ? false : conversations().deleteConversation(id);
