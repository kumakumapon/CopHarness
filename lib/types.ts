/**
 * Provider-neutral conversation model shared by the agent loop, providers,
 * session storage and every interface (CLI, HTTP, web UI, chat channels).
 */

export interface TextPart { type: 'text'; text: string }
export interface ImagePart { type: 'image'; mimeType: string; data: string /* base64 */ }
export interface ToolCallPart { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
export interface ToolResultPart { type: 'tool_result'; toolCallId: string; name: string; content: string; isError?: boolean }
export interface ReasoningPart { type: 'reasoning'; text: string }

export type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart | ReasoningPart;

export interface Message {
  role: 'user' | 'assistant';
  content: ContentPart[];
  /**
   * Provider-native assistant content. When the same provider reads the
   * conversation again it is replayed byte-for-byte, which keeps prompt caches
   * warm and reasoning signatures (Anthropic thinking, Gemini thought
   * signatures) valid. Other providers use `content`.
   */
  native?: { provider: string; content: unknown };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export function addUsage(a: Usage, b: Partial<Usage> | undefined): Usage {
  return {
    inputTokens: a.inputTokens + (b?.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b?.outputTokens ?? 0),
    cacheReadTokens: a.cacheReadTokens + (b?.cacheReadTokens ?? 0),
    cacheWriteTokens: a.cacheWriteTokens + (b?.cacheWriteTokens ?? 0),
  };
}

/** JSON Schema (the subset tools use). */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

/** What the model sees for a tool. Snapshotted per session so the tool list stays stable. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn';

export interface TodoItem { content: string; status: 'pending' | 'in_progress' | 'completed' }

export type PermissionDecision = 'allow' | 'allow_always' | 'deny';

export interface PermissionRequest {
  id: string;
  sessionId: string;
  toolCallId: string;
  tool: string;
  input: Record<string, unknown>;
  /** Short human-readable description of what will happen (command, path, URL...). */
  summary: string;
  reason: string;
  createdAt: string;
}

/** Why a turn ended. */
export type TurnStopReason =
  | 'end_turn'
  | 'max_turns'
  | 'max_tokens'
  | 'refusal'
  | 'cancelled'
  | 'budget'
  | 'blocked'
  | 'error';

/** Events emitted while a turn runs. Every interface renders the same stream. */
export type AgentEvent =
  | { type: 'turn_start'; sessionId: string; model: string }
  | { type: 'text_delta'; text: string; agent?: string }
  | { type: 'reasoning_delta'; text: string; agent?: string }
  | { type: 'message'; message: Message; agent?: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown>; summary: string; agent?: string }
  | { type: 'tool_result'; id: string; name: string; content: string; isError: boolean; durationMs: number; agent?: string }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; id: string; decision: PermissionDecision; by?: string }
  | { type: 'todos'; todos: TodoItem[] }
  | { type: 'compaction'; beforeTokens: number; afterTokens: number }
  | { type: 'usage'; usage: Usage; costUsd?: number }
  | { type: 'notice'; message: string }
  | { type: 'turn_end'; stopReason: TurnStopReason; text: string; usage: Usage; costUsd?: number; error?: string };

export function messageText(message: Message): string {
  return message.content.filter((p): p is TextPart => p.type === 'text').map(p => p.text).join('');
}

export function userMessage(text: string, images: ImagePart[] = []): Message {
  return { role: 'user', content: [...images, { type: 'text', text }] };
}
