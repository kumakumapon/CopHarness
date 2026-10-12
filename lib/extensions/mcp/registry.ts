/**
 * MCP server registry — records metadata about each server that was loaded,
 * including which tools were loaded or skipped, and any errors encountered.
 */

export interface McpServerRecord {
  name: string;
  url: string;
  toolCount: number;
  loadedToolNames: string[];
  skippedToolNames: string[];
  includeTools?: string[];
  excludeTools?: string[];
  loadedAt: string;
  error?: string;
}

const _registry = new Map<string, McpServerRecord>();

/** Record a server in the registry (upsert by name). */
export function recordMcpServer(record: McpServerRecord): void {
  _registry.set(record.name, record);
}

/** Return all recorded MCP server entries. */
export function listMcpServers(): McpServerRecord[] {
  return Array.from(_registry.values());
}

/** Reset registry state — for use in tests only. */
export function _resetMcpRegistryForTests(): void {
  _registry.clear();
}
