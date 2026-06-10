import { loadMcpSkills } from '../../lib/mcp/skillBridge';
import { listMcpServers, _resetMcpRegistryForTests } from '../../lib/mcp/registry';
import type { McpToolsListResult } from '../../lib/mcp/types';

// ---------------------------------------------------------------------------
// Mock McpClient
// ---------------------------------------------------------------------------

const mockListTools = jest.fn<Promise<McpToolsListResult>, []>();
const mockInitialize = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);

jest.mock('../../lib/mcp/client', () => ({
  McpClient: jest.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    listTools: mockListTools,
    callTool: jest.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTools(names: string[]): McpToolsListResult {
  return {
    tools: names.map((name) => ({ name, description: `Tool ${name}` })),
  };
}

const BASE_CONFIG = { url: 'http://mcp.example.com', name: 'testserver' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadMcpSkills — tool filter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetMcpRegistryForTests();
  });

  it('loads all tools when no filter is specified', async () => {
    mockListTools.mockResolvedValue(makeTools(['toolA', 'toolB', 'toolC']));
    const skills = await loadMcpSkills(BASE_CONFIG);
    expect(skills).toHaveLength(3);
    expect(skills.map((s) => s.name)).toContain('mcp_testserver_toolA');
  });

  it('applies includeTools filter — only matching tools are loaded', async () => {
    mockListTools.mockResolvedValue(makeTools(['readTool', 'writeTool', 'deleteTool']));
    const skills = await loadMcpSkills({ ...BASE_CONFIG, includeTools: ['read*'] });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('mcp_testserver_readTool');
  });

  it('applies excludeTools filter — matching tools are skipped', async () => {
    mockListTools.mockResolvedValue(makeTools(['readTool', 'writeTool', 'deleteTool']));
    const skills = await loadMcpSkills({ ...BASE_CONFIG, excludeTools: ['delete*'] });
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name)).not.toContain('mcp_testserver_deleteTool');
  });

  it('applies both includeTools and excludeTools — include first, then exclude', async () => {
    mockListTools.mockResolvedValue(makeTools(['readFile', 'readDir', 'writeFile', 'deleteFile']));
    const skills = await loadMcpSkills({
      ...BASE_CONFIG,
      includeTools: ['read*', 'write*'],
      excludeTools: ['*Dir'],
    });
    const names = skills.map((s) => s.name);
    expect(names).toContain('mcp_testserver_readFile');
    expect(names).toContain('mcp_testserver_writeFile');
    expect(names).not.toContain('mcp_testserver_readDir');
    expect(names).not.toContain('mcp_testserver_deleteFile');
  });
});

describe('MCP registry recording', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetMcpRegistryForTests();
  });

  it('records loaded and skipped tool names in registry', async () => {
    mockListTools.mockResolvedValue(makeTools(['alpha', 'beta', 'gamma']));
    await loadMcpSkills({ ...BASE_CONFIG, excludeTools: ['beta'] });
    const servers = listMcpServers();
    expect(servers).toHaveLength(1);
    const srv = servers[0];
    expect(srv.toolCount).toBe(2);
    expect(srv.loadedToolNames).toContain('mcp_testserver_alpha');
    expect(srv.loadedToolNames).toContain('mcp_testserver_gamma');
    expect(srv.skippedToolNames).toContain('mcp_testserver_beta');
  });

  it('records error for failed server', async () => {
    mockListTools.mockRejectedValue(new Error('connection refused'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await loadMcpSkills(BASE_CONFIG);
    const servers = listMcpServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].error).toContain('connection refused');
    expect(servers[0].toolCount).toBe(0);
    warnSpy.mockRestore();
  });

  it('records includeTools and excludeTools in registry entry', async () => {
    mockListTools.mockResolvedValue(makeTools(['toolA']));
    await loadMcpSkills({
      ...BASE_CONFIG,
      includeTools: ['tool*'],
      excludeTools: ['toolZ*'],
    });
    const srv = listMcpServers()[0];
    expect(srv.includeTools).toEqual(['tool*']);
    expect(srv.excludeTools).toEqual(['toolZ*']);
  });

  it('records loadedAt timestamp', async () => {
    mockListTools.mockResolvedValue(makeTools(['toolA']));
    const before = new Date().toISOString();
    await loadMcpSkills(BASE_CONFIG);
    const after = new Date().toISOString();
    const srv = listMcpServers()[0];
    expect(srv.loadedAt >= before).toBe(true);
    expect(srv.loadedAt <= after).toBe(true);
  });
});
