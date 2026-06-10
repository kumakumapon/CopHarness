import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

// Must import skills before toolsets so the skill registry is populated
import '../../lib/skills/index';
import {
  listToolsets,
  getToolset,
  resolveToolsetSkillNames,
  matchesGlob,
  _resetToolsetsForTests,
} from '../../lib/skills/toolsets';

describe('matchesGlob', () => {
  it('matches exact names (no wildcard)', () => {
    expect(matchesGlob('webSearch', 'webSearch')).toBe(true);
    expect(matchesGlob('webSearch', 'fetchUrl')).toBe(false);
  });

  it('matches prefix wildcard', () => {
    expect(matchesGlob('memory*', 'memorySet')).toBe(true);
    expect(matchesGlob('memory*', 'memoryGet')).toBe(true);
    expect(matchesGlob('memory*', 'fetchUrl')).toBe(false);
  });

  it('matches suffix wildcard', () => {
    expect(matchesGlob('*Search', 'webSearch')).toBe(true);
    expect(matchesGlob('*Search', 'githubSearch')).toBe(true);
    expect(matchesGlob('*Search', 'readFile')).toBe(false);
  });

  it('treats ? as a literal character, not a wildcard', () => {
    expect(matchesGlob('memory?*', 'memorySet')).toBe(false);
    expect(matchesGlob('memory?', 'memory?')).toBe(true);
    expect(matchesGlob('foo?', 'fo')).toBe(false);
  });

  it('matches mid-string wildcard', () => {
    // note*e matches noteCreate because noteCreate ends in 'e'
    expect(matchesGlob('note*e', 'noteCreate')).toBe(true);
    expect(matchesGlob('note*', 'noteCreate')).toBe(true);
    // note*x does not match noteCreate (doesn't end in x)
    expect(matchesGlob('note*x', 'noteCreate')).toBe(false);
  });

  it('handles special regex characters in pattern', () => {
    expect(matchesGlob('a.b', 'axb')).toBe(false); // dot is literal
    expect(matchesGlob('a.b', 'a.b')).toBe(true);
  });
});

describe('listToolsets — builtins', () => {
  beforeEach(() => {
    _resetToolsetsForTests();
  });

  it('returns all 5 built-in toolsets when no custom file exists', () => {
    const toolsets = listToolsets();
    const names = toolsets.map((t) => t.name);
    expect(names).toContain('research');
    expect(names).toContain('coding');
    expect(names).toContain('office');
    expect(names).toContain('personal');
    expect(names).toContain('dangerous');
  });

  it('each built-in toolset has source=builtin', () => {
    const toolsets = listToolsets().filter((t) => t.source === 'builtin');
    expect(toolsets.length).toBeGreaterThanOrEqual(5);
  });

  it('research toolset includes webSearch', () => {
    const research = getToolset('research');
    expect(research).toBeDefined();
    expect(research!.skills).toContain('webSearch');
  });

  it('dangerous toolset includes runCommand and writeFile', () => {
    const dangerous = getToolset('dangerous');
    expect(dangerous).toBeDefined();
    expect(dangerous!.skills).toContain('runCommand');
    expect(dangerous!.skills).toContain('writeFile');
  });
});

describe('custom toolsets from file', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-toolsets-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetToolsetsForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.TOOLSETS_FILE;
    _resetDataDirCache();
    _resetToolsetsForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads custom toolsets from toolsets.json', () => {
    const toolsetsFile = path.join(tmpDir, 'toolsets.json');
    fs.writeFileSync(
      toolsetsFile,
      JSON.stringify({
        version: 1,
        toolsets: [{ name: 'mytools', description: 'My custom tools', skills: ['calculator', 'hashText'] }],
      }),
    );
    const toolsets = listToolsets();
    const custom = toolsets.find((t) => t.name === 'mytools');
    expect(custom).toBeDefined();
    expect(custom!.source).toBe('custom');
    expect(custom!.skills).toContain('calculator');
  });

  it('custom toolset overrides builtin with same name', () => {
    const toolsetsFile = path.join(tmpDir, 'toolsets.json');
    fs.writeFileSync(
      toolsetsFile,
      JSON.stringify({
        version: 1,
        toolsets: [{ name: 'research', description: 'Override research', skills: ['calculator'] }],
      }),
    );
    const toolsets = listToolsets();
    const research = toolsets.find((t) => t.name === 'research');
    expect(research!.source).toBe('custom');
    expect(research!.skills).toContain('calculator');
    expect(research!.skills).not.toContain('webSearch');
  });

  it('ignores invalid toolsets.json and returns only builtins', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const toolsetsFile = path.join(tmpDir, 'toolsets.json');
    fs.writeFileSync(toolsetsFile, 'not valid json{{');
    const toolsets = listToolsets();
    const names = toolsets.map((t) => t.name);
    expect(names).toContain('research'); // builtins still present
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('respects TOOLSETS_FILE env override', () => {
    const customFile = path.join(tmpDir, 'my-toolsets.json');
    process.env.TOOLSETS_FILE = customFile;
    fs.writeFileSync(
      customFile,
      JSON.stringify({
        version: 1,
        toolsets: [{ name: 'envtools', description: 'Env override', skills: ['calculator'] }],
      }),
    );
    const toolsets = listToolsets();
    expect(toolsets.find((t) => t.name === 'envtools')).toBeDefined();
  });
});

describe('resolveToolsetSkillNames', () => {
  beforeEach(() => {
    _resetToolsetsForTests();
  });

  it('resolves research toolset to registered skill names', () => {
    const names = resolveToolsetSkillNames(['research']);
    expect(names).toContain('webSearch');
    expect(names).toContain('fetchUrl');
    expect(names).toContain('memorySearch');
  });

  it('resolves multiple toolsets and deduplicates', () => {
    const names = resolveToolsetSkillNames(['research', 'dangerous']);
    // runCommand only appears once even if in multiple toolsets
    const runCommands = names.filter((n) => n === 'runCommand');
    expect(runCommands.length).toBe(1);
  });

  it('only returns skills that are registered', () => {
    const names = resolveToolsetSkillNames(['research']);
    // All returned names should be in the skill registry
    const { listSkills } = require('../../lib/skill') as typeof import('../../lib/skill');
    const registered = new Set(listSkills().map((s) => s.name));
    for (const name of names) {
      expect(registered.has(name)).toBe(true);
    }
  });

  it('warns and skips unknown toolset names', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const names = resolveToolsetSkillNames(['nonexistent_toolset_xyz']);
    expect(names).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent_toolset_xyz'));
    warnSpy.mockRestore();
  });

  it('returns empty array for empty input', () => {
    expect(resolveToolsetSkillNames([])).toEqual([]);
  });
});
