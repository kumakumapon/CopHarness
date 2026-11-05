/**
 * MCP client: connects to the servers in `mcpServers` (stdio or HTTP) with the
 * official SDK and exposes their tools as `mcp__<server>__<tool>`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from './config';
import { childEnv } from './tools/bash';
import { truncateMiddle, type Tool } from './tools/types';
import type { JsonSchema } from './types';

export interface McpServerStatus {
  name: string;
  state: 'connecting' | 'connected' | 'failed' | 'disabled';
  transport: 'stdio' | 'http';
  error?: string;
  tools: string[];
}

interface Connection {
  status: McpServerStatus;
  client?: Client;
  tools: Tool[];
}

const CONNECT_TIMEOUT_MS = 20_000;

export function mcpToolName(server: string, tool: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `mcp__${clean(server)}__${clean(tool)}`.slice(0, 64);
}

function resultToText(result: { content?: unknown; structuredContent?: unknown; toolResult?: unknown }): string {
  const parts: string[] = [];
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content as Array<Record<string, unknown>>) {
    if (item.type === 'text') parts.push(String(item.text ?? ''));
    else if (item.type === 'resource') {
      const resource = item.resource as { uri?: string; text?: string } | undefined;
      parts.push(resource?.text ?? `[resource ${resource?.uri ?? ''}]`);
    } else if (item.type === 'resource_link') parts.push(`[resource ${String(item.uri ?? '')}]`);
    else parts.push(`[${String(item.type)}]`);
  }
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  if (!parts.length && result.toolResult !== undefined) parts.push(JSON.stringify(result.toolResult));
  return parts.join('\n');
}

export type TransportFactory = (name: string, config: McpServerConfig) => Transport | Promise<Transport>;

const defaultTransport: TransportFactory = (_name, config) => {
  if (config.url) {
    return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } });
  }
  return new StdioClientTransport({
    command: config.command!,
    args: config.args ?? [],
    env: { ...(childEnv() as Record<string, string>), ...(config.env ?? {}) },
    cwd: config.cwd,
    stderr: 'ignore',
  });
};

export class McpManager {
  private readonly connections = new Map<string, Connection>();
  private ready?: Promise<void>;

  constructor(
    private readonly servers: Record<string, McpServerConfig>,
    private readonly transportFactory: TransportFactory = defaultTransport,
  ) {}

  /** Connect to every configured server once; failures are recorded, not thrown. */
  start(): Promise<void> {
    this.ready ??= Promise.all(Object.entries(this.servers).map(([name, cfg]) => this.connect(name, cfg))).then(() => undefined);
    return this.ready;
  }

  private async connect(name: string, config: McpServerConfig): Promise<void> {
    const status: McpServerStatus = { name, state: config.disabled ? 'disabled' : 'connecting', transport: config.url ? 'http' : 'stdio', tools: [] };
    const conn: Connection = { status, tools: [] };
    this.connections.set(name, conn);
    if (config.disabled) return;
    const client = new Client({ name: 'copharness', version: '2.0.0' });
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('接続がタイムアウトしました')), CONNECT_TIMEOUT_MS); });
      try {
        await Promise.race([client.connect(await this.transportFactory(name, config)), timeout]);
      } catch (err) {
        // Older servers only speak the 2024-11-05 HTTP+SSE transport.
        if (!config.url || this.transportFactory !== defaultTransport) throw err;
        await Promise.race([client.connect(new SSEClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } })), timeout]);
      }
      const listed: Array<{ name: string; description?: string; inputSchema: unknown; annotations?: { readOnlyHint?: boolean } }> = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        listed.push(...(page.tools as typeof listed));
        cursor = page.nextCursor;
      } while (cursor);
      conn.client = client;
      conn.tools = listed.map(t => this.wrapTool(name, client, t));
      status.tools = conn.tools.map(t => t.name);
      status.state = 'connected';
    } catch (err) {
      status.state = 'failed';
      status.error = err instanceof Error ? err.message : String(err);
      await client.close().catch(() => {});
    } finally {
      clearTimeout(timer);
    }
  }

  private wrapTool(server: string, client: Client, def: { name: string; description?: string; inputSchema: unknown; annotations?: { readOnlyHint?: boolean } }): Tool {
    const schema = (def.inputSchema && typeof def.inputSchema === 'object' ? def.inputSchema : {}) as JsonSchema;
    return {
      name: mcpToolName(server, def.name),
      description: `[MCP: ${server}] ${def.description ?? def.name}`.slice(0, 1024),
      inputSchema: { ...schema, type: 'object', properties: schema.properties ?? {} },
      access: def.annotations?.readOnlyHint ? 'read' : 'execute',
      summarize: input => `${server}.${def.name} ${JSON.stringify(input).slice(0, 100)}`,
      async run(input, ctx) {
        const result = await client.callTool({ name: def.name, arguments: input }, undefined, { signal: ctx.signal, timeout: 300_000 });
        return { content: truncateMiddle(resultToText(result), 50_000) || '（結果なし）', isError: Boolean(result.isError) };
      },
    };
  }

  tools(): Tool[] {
    return [...this.connections.values()].flatMap(c => c.tools);
  }

  status(): McpServerStatus[] {
    const known = new Map([...this.connections.values()].map(c => [c.status.name, c.status]));
    return Object.keys(this.servers).map(name => known.get(name) ?? { name, state: 'connecting', transport: this.servers[name].url ? 'http' : 'stdio', tools: [] });
  }

  async close(): Promise<void> {
    await Promise.all([...this.connections.values()].map(c => c.client?.close().catch(() => {})));
    this.connections.clear();
    this.ready = undefined;
  }
}
