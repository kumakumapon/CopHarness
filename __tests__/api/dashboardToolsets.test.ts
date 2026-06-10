import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { _resetToolsetsForTests } from '../../lib/skills/toolsets';
import { _resetMcpRegistryForTests } from '../../lib/mcp/registry';

// Ensure skills are registered before the route handler runs
import '../../lib/skills/index';

// Must import after skills/index so registry is populated
import { GET } from '../../app/api/dashboard/toolsets/route';

describe('dashboard toolsets API', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-dashboard-toolsets-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetToolsetsForTests();
    _resetMcpRegistryForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.COPHARNESS_API_KEY;
    _resetDataDirCache();
    _resetToolsetsForTests();
    _resetMcpRegistryForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function request(url = 'http://localhost:3000/api/dashboard/toolsets') {
    return new NextRequest(url);
  }

  it('returns 200 with toolsets and mcpServers arrays', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const data = await res.json() as { toolsets: unknown[]; mcpServers: unknown[] };
    expect(Array.isArray(data.toolsets)).toBe(true);
    expect(Array.isArray(data.mcpServers)).toBe(true);
  });

  it('returns 401 when API key is required but missing', async () => {
    process.env.COPHARNESS_API_KEY = 'secret';
    const res = await GET(request());
    expect(res.status).toBe(401);
  });

  it('accepts valid API key', async () => {
    process.env.COPHARNESS_API_KEY = 'secret';
    const req = new NextRequest('http://localhost:3000/api/dashboard/toolsets', {
      headers: { Authorization: 'Bearer secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it('built-in toolsets are present in the response', async () => {
    const res = await GET(request());
    const data = await res.json() as { toolsets: Array<{ name: string; source: string; skillCount: number; skills: unknown[] }> };
    const names = data.toolsets.map((t) => t.name);
    expect(names).toContain('research');
    expect(names).toContain('coding');
    expect(names).toContain('office');
    expect(names).toContain('personal');
    expect(names).toContain('dangerous');
  });

  it('each toolset entry has required fields', async () => {
    const res = await GET(request());
    const data = await res.json() as { toolsets: Array<{ name: string; source: string; description: string; skillCount: number; skills: Array<{ name: string; riskLevel: string; active: boolean; registered: boolean }> }> };
    for (const ts of data.toolsets) {
      expect(typeof ts.name).toBe('string');
      expect(typeof ts.description).toBe('string');
      expect(['builtin', 'custom']).toContain(ts.source);
      expect(typeof ts.skillCount).toBe('number');
      expect(Array.isArray(ts.skills)).toBe(true);
    }
  });

  it('skill entries within toolsets have correct shape', async () => {
    const res = await GET(request());
    const data = await res.json() as { toolsets: Array<{ skills: Array<{ name: string; riskLevel: string; active: boolean; registered: boolean }> }> };
    const researchToolset = data.toolsets.find((t) => (t as unknown as { name: string }).name === 'research');
    expect(researchToolset).toBeDefined();
    for (const skill of researchToolset!.skills) {
      expect(typeof skill.name).toBe('string');
      expect(['low', 'medium', 'high']).toContain(skill.riskLevel);
      expect(typeof skill.active).toBe('boolean');
      expect(typeof skill.registered).toBe('boolean');
    }
  });

  it('mcpServers is empty when no servers have been loaded', async () => {
    const res = await GET(request());
    const data = await res.json() as { mcpServers: unknown[] };
    expect(data.mcpServers).toHaveLength(0);
  });
});
