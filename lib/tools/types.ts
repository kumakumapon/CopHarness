import type { AgentEvent, JsonSchema, TodoItem, ToolSpec } from '../types';

/**
 * How a tool affects the world. Permission modes decide per class:
 * - read:    no side effects (auto-allowed; may run in parallel)
 * - state:   harness-internal state such as todos and memory notes (auto-allowed)
 * - edit:    changes files in the workspace (auto in acceptEdits / bypass)
 * - execute: shell commands, external side effects, MCP tools (auto only in bypass)
 */
export type ToolAccess = 'read' | 'state' | 'edit' | 'execute';

export interface ToolOutput {
  content: string;
  isError?: boolean;
}

export interface ToolContext {
  sessionId: string;
  workspace: string;
  dataDir: string;
  /** Owner of the session ("local", "discord:123", ...) used to scope memory. */
  scope: string;
  signal: AbortSignal;
  emit(event: AgentEvent): void;
  setTodos(todos: TodoItem[]): void;
  /** Present in top-level agents only: run a sub-agent with a fresh context. */
  runSubagent?(description: string, prompt: string): Promise<string>;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  access: ToolAccess;
  /** Value matched by permission rules such as `bash(git *)` or `write_file(docs/*)`. */
  subject?(input: Record<string, unknown>): string | undefined;
  /** One-line description shown in UIs and approval prompts. */
  summarize?(input: Record<string, unknown>): string;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}

export function toolSpec(tool: Tool): ToolSpec {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

export function summarizeCall(tool: Tool | undefined, input: Record<string, unknown>): string {
  if (tool?.summarize) {
    try { return tool.summarize(input); } catch { /* fall through */ }
  }
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 117)}...` : json;
}

/** Validate a value against the JSON Schema subset tools use. Returns error messages. */
export function validateInput(schema: JsonSchema, value: unknown, path = 'input'): string[] {
  const errors: string[] = [];
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (types.length) {
    const actual = typeOf(value);
    const ok = types.some(t => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) return [`${path} は ${types.join(' | ')} である必要があります（実際: ${actual}）`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} は ${schema.enum.map(v => JSON.stringify(v)).join(', ')} のいずれかです`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} は ${schema.minimum} 以上です`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} は ${schema.maximum} 以下です`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined || obj[key] === null) errors.push(`${path}.${key} は必須です`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (obj[key] !== undefined && obj[key] !== null) errors.push(...validateInput(sub, obj[key], `${path}.${key}`));
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validateInput(schema.items!, item, `${path}[${i}]`)));
  }
  return errors;
}

/** Keep the beginning and the end of long output. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n… (${text.length - max} 文字省略) …\n\n${text.slice(-tail)}`;
}

export const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
