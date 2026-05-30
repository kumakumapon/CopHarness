import type { SkillDefinition, SkillParameterSchema } from '../skill';
import type { McpTool, McpServerConfig } from './types';
import { McpClient } from './client';

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

export async function loadMcpSkills(
  config: McpServerConfig,
): Promise<SkillDefinition[]> {
  const client = new McpClient(config);
  try {
    const { tools } = await client.listTools();
    const rawName = config.name ?? new URL(config.url).hostname;
    const serverName = rawName.replace(/[^a-zA-Z0-9]/g, '_');
    return tools.map((tool) => mcpToolToSkill(tool, client, serverName));
  } catch (err) {
    console.warn(`[MCP] Failed to load skills from ${config.url}:`, err);
    return [];
  }
}
