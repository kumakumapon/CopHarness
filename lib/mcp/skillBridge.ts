import type { SkillDefinition, SkillParameterSchema } from '../skill';
import type { McpTool, McpServerConfig } from './types';
import { McpClient } from './client';
import { matchesGlob } from '../skills/toolsets';
import { recordMcpServer } from './registry';

export function mcpToolToSkill(
  tool: McpTool,
  client: McpClient,
  serverName: string,
): SkillDefinition {
  const inputSchema = tool.inputSchema;
  const parameters: SkillParameterSchema = {
    type: 'object',
    properties:
      (inputSchema?.properties as SkillParameterSchema['properties']) ?? {},
    required: inputSchema?.required,
  };

  return {
    name: `mcp_${serverName}_${tool.name}`,
    description: `[MCP:${serverName}] ${tool.description ?? tool.name}`,
    parameters,
    category: 'external',
    riskLevel: 'medium',
    handler: async (args) => {
      try {
        const result = await client.callTool(tool.name, args);
        const textContent = result.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text as string)
          .join('\n');
        return {
          content: textContent || JSON.stringify(result.content),
          isError: result.isError,
        };
      } catch (err) {
        return {
          content: `MCP tool error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };
}

/**
 * Apply include/exclude glob filters to a list of raw MCP tools.
 * - includeTools: if present, tool must match at least one pattern.
 * - excludeTools: if present, tool must not match any pattern.
 * Returns { included, skipped }.
 */
function applyToolFilter(
  tools: McpTool[],
  includeTools?: string[],
  excludeTools?: string[],
): { included: McpTool[]; skipped: McpTool[] } {
  const included: McpTool[] = [];
  const skipped: McpTool[] = [];

  for (const tool of tools) {
    // Apply include filter first
    if (includeTools && includeTools.length > 0) {
      const passes = includeTools.some((pattern) => matchesGlob(pattern, tool.name));
      if (!passes) {
        skipped.push(tool);
        continue;
      }
    }
    // Apply exclude filter
    if (excludeTools && excludeTools.length > 0) {
      const excluded = excludeTools.some((pattern) => matchesGlob(pattern, tool.name));
      if (excluded) {
        skipped.push(tool);
        continue;
      }
    }
    included.push(tool);
  }

  return { included, skipped };
}

export async function loadMcpSkills(
  config: McpServerConfig,
): Promise<SkillDefinition[]> {
  const rawName = config.name ?? (() => {
    try { return new URL(config.url).hostname; } catch { return config.url; }
  })();
  const serverName = rawName.replace(/[^a-zA-Z0-9]/g, '_');
  const client = new McpClient(config);

  try {
    const { tools } = await client.listTools();
    const { included, skipped } = applyToolFilter(tools, config.includeTools, config.excludeTools);
    const skills = included.map((tool) => mcpToolToSkill(tool, client, serverName));

    recordMcpServer({
      name: serverName,
      url: config.url,
      toolCount: included.length,
      loadedToolNames: skills.map((s) => s.name),
      skippedToolNames: skipped.map((t) => `mcp_${serverName}_${t.name}`),
      includeTools: config.includeTools,
      excludeTools: config.excludeTools,
      loadedAt: new Date().toISOString(),
    });

    return skills;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[MCP] Failed to load skills from ${config.url}:`, err);

    recordMcpServer({
      name: serverName,
      url: config.url,
      toolCount: 0,
      loadedToolNames: [],
      skippedToolNames: [],
      includeTools: config.includeTools,
      excludeTools: config.excludeTools,
      loadedAt: new Date().toISOString(),
      error: errorMsg,
    });

    return [];
  }
}
