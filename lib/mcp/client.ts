import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpToolsListResult,
  McpToolCallResult,
  McpServerConfig,
} from './types';

let _requestId = 0;
function nextId(): number {
  return ++_requestId;
}

async function rpc<T>(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: nextId(),
    method,
    params,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...extraHeaders,
    },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`MCP HTTP ${resp.status} from ${url}: ${body}`);
  }
  const data = (await resp.json()) as JsonRpcResponse<T>;
  if (data.error) {
    throw new Error(`MCP RPC error ${data.error.code}: ${data.error.message}`);
  }
  return data.result as T;
}

export class McpClient {
  private initialized = false;

  constructor(private readonly config: McpServerConfig) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await rpc(
      this.config.url,
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'copharness', version: '0.1.0' },
      },
      this.config.headers ?? {},
    );
    this.initialized = true;
  }

  async listTools(): Promise<McpToolsListResult> {
    await this.initialize();
    return rpc<McpToolsListResult>(
      this.config.url,
      'tools/list',
      {},
      this.config.headers ?? {},
    );
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    await this.initialize();
    return rpc<McpToolCallResult>(
      this.config.url,
      'tools/call',
      { name, arguments: args },
      this.config.headers ?? {},
    );
  }
}
