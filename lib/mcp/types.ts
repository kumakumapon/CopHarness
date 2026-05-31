export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolsListResult {
  tools: McpTool[];
  nextCursor?: string;
}

export interface McpToolCallResult {
  content: Array<{ type: 'text' | 'image' | 'resource'; text?: string }>;
  isError?: boolean;
}

export interface McpServerConfig {
  url: string;
  name?: string;
  headers?: Record<string, string>;
}
