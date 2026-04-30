/**
 * Unit tests for new built-in skills (Phase 1–6).
 */

import {
  listSkills,
  listActiveSkills,
  resolveSkills,
  getSkill,
  type SkillDefinition,
} from '../../lib/skill';

// Import to trigger registration
import '../../lib/skills/index';

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

describe('SkillDefinition metadata', () => {
  it('listSkills includes all new skills', () => {
    const names = listSkills().map((s) => s.name);
    const expected = [
      'currentDateTime',
      'calculator', 'randomNumber', 'uuidGenerate', 'base64Encode', 'base64Decode', 'jsonFormat',
      'readFile', 'writeFile', 'listDirectory', 'searchInFiles',
      'fetchUrl', 'webSearch', 'getWeather',
      'runCommand', 'getSystemInfo', 'getEnvVariable',
      'memorySet', 'memoryGet', 'memoryList',
      'githubSearch', 'translateText', 'sendNotification',
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  it('all skills have a category', () => {
    for (const skill of listSkills()) {
      expect(skill.category).toBeDefined();
    }
  });

  it('all skills have a riskLevel', () => {
    for (const skill of listSkills()) {
      expect(['low', 'medium', 'high']).toContain(skill.riskLevel);
    }
  });

  it('skills requiring an API key have requiresEnv set', () => {
    const withEnv: Record<string, string[]> = {
      webSearch: ['TAVILY_API_KEY'],
      translateText: ['DEEPL_API_KEY'],
      sendNotification: ['SLACK_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL'],
    };
    for (const [name, vars] of Object.entries(withEnv)) {
      const skill = getSkill(name);
      expect(skill).toBeDefined();
      for (const v of vars) {
        expect(skill!.requiresEnv).toContain(v);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ENABLED_SKILLS filtering
// ---------------------------------------------------------------------------

describe('ENABLED_SKILLS filtering', () => {
  const saved = process.env.ENABLED_SKILLS;
  afterEach(() => {
    if (saved === undefined) delete process.env.ENABLED_SKILLS;
    else process.env.ENABLED_SKILLS = saved;
  });

  it('listActiveSkills returns all skills when ENABLED_SKILLS is not set', () => {
    delete process.env.ENABLED_SKILLS;
    expect(listActiveSkills().length).toBe(listSkills().length);
  });

  it('listActiveSkills filters to specified skills', () => {
    process.env.ENABLED_SKILLS = 'currentDateTime,calculator';
    const active = listActiveSkills();
    expect(active.map((s) => s.name)).toEqual(expect.arrayContaining(['currentDateTime', 'calculator']));
    expect(active.length).toBe(2);
  });

  it('resolveSkills respects ENABLED_SKILLS whitelist', () => {
    process.env.ENABLED_SKILLS = 'currentDateTime';
    const result = resolveSkills(['currentDateTime', 'calculator']);
    expect(result.map((s) => s.name)).toEqual(['currentDateTime']);
  });

  it('resolveSkills returns all requested skills when ENABLED_SKILLS is empty string', () => {
    process.env.ENABLED_SKILLS = '';
    const result = resolveSkills(['currentDateTime', 'calculator']);
    expect(result.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Phase 1: Utility skills
// ---------------------------------------------------------------------------

import { calculator } from '../../lib/skills/calculator';
import { randomNumber } from '../../lib/skills/randomNumber';
import { uuidGenerate } from '../../lib/skills/uuidGenerate';
import { base64Encode, base64Decode } from '../../lib/skills/base64';
import { jsonFormat } from '../../lib/skills/jsonFormat';

describe('calculator skill', () => {
  async function calc(expression: string) {
    return calculator.handler({ expression });
  }

  it('basic arithmetic', async () => {
    expect((await calc('2 + 3')).content).toBe('5');
    expect((await calc('10 - 4')).content).toBe('6');
    expect((await calc('3 * 4')).content).toBe('12');
    expect((await calc('10 / 4')).content).toBe('2.5');
    expect((await calc('10 % 3')).content).toBe('1');
  });

  it('parentheses', async () => {
    expect((await calc('(2 + 3) * 4')).content).toBe('20');
  });

  it('power operator', async () => {
    expect((await calc('2 ^ 10')).content).toBe('1024');
  });

  it('math functions', async () => {
    expect((await calc('sqrt(16)')).content).toBe('4');
    expect((await calc('abs(-5)')).content).toBe('5');
    expect((await calc('round(3.7)')).content).toBe('4');
    expect((await calc('floor(3.9)')).content).toBe('3');
    expect((await calc('ceil(3.1)')).content).toBe('4');
  });

  it('constants pi and e', async () => {
    const pi = await calc('pi');
    expect(parseFloat(pi.content)).toBeCloseTo(Math.PI, 10);
    const e = await calc('e');
    expect(parseFloat(e.content)).toBeCloseTo(Math.E, 10);
  });

  it('min and max with two args', async () => {
    expect((await calc('min(3, 7)')).content).toBe('3');
    expect((await calc('max(3, 7)')).content).toBe('7');
  });

  it('division by zero returns Infinity', async () => {
    const result = await calc('1 / 0');
    expect(result.isError).toBeTruthy();
  });

  it('empty expression returns error', async () => {
    const result = await calc('');
    expect(result.isError).toBe(true);
  });

  it('unknown function returns error', async () => {
    const result = await calc('foo(3)');
    expect(result.isError).toBe(true);
  });
});

describe('randomNumber skill', () => {
  it('returns a number in range [0, 1] by default', async () => {
    const result = await randomNumber.handler({});
    const n = parseFloat(result.content);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(1);
  });

  it('returns an integer when integer=true', async () => {
    const result = await randomNumber.handler({ min: 1, max: 10, integer: true });
    const n = parseInt(result.content, 10);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(10);
  });

  it('returns error when min > max', async () => {
    const result = await randomNumber.handler({ min: 10, max: 5 });
    expect(result.isError).toBe(true);
  });
});

describe('uuidGenerate skill', () => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('generates a valid UUID v4 by default', async () => {
    const result = await uuidGenerate.handler({});
    expect(result.content).toMatch(uuidRegex);
  });

  it('generates multiple UUIDs', async () => {
    const result = await uuidGenerate.handler({ count: 3 });
    const lines = result.content.split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toMatch(uuidRegex);
  });

  it('caps at 100', async () => {
    const result = await uuidGenerate.handler({ count: 200 });
    expect(result.content.split('\n')).toHaveLength(100);
  });
});

describe('base64Encode / base64Decode skills', () => {
  it('encodes a string', async () => {
    const result = await base64Encode.handler({ text: 'hello world' });
    expect(result.content).toBe('aGVsbG8gd29ybGQ=');
  });

  it('decodes a string', async () => {
    const result = await base64Decode.handler({ encoded: 'aGVsbG8gd29ybGQ=' });
    expect(result.content).toBe('hello world');
  });

  it('round-trips correctly', async () => {
    const original = 'CopHarness テスト 🚀';
    const encoded = await base64Encode.handler({ text: original });
    const decoded = await base64Decode.handler({ encoded: encoded.content });
    expect(decoded.content).toBe(original);
  });
});

describe('jsonFormat skill', () => {
  it('formats valid JSON with default indent (2)', async () => {
    const result = await jsonFormat.handler({ json: '{"a":1,"b":2}' });
    expect(result.content).toBe(JSON.stringify({ a: 1, b: 2 }, null, 2));
    expect(result.isError).toBeFalsy();
  });

  it('formats with custom indent', async () => {
    const result = await jsonFormat.handler({ json: '[1,2,3]', indent: 4 });
    expect(result.content).toBe(JSON.stringify([1, 2, 3], null, 4));
  });

  it('returns error for invalid JSON', async () => {
    const result = await jsonFormat.handler({ json: '{invalid}' });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: File skills
// ---------------------------------------------------------------------------

import { readFile } from '../../lib/skills/readFile';
import { writeFile } from '../../lib/skills/writeFile';
import { listDirectory } from '../../lib/skills/listDirectory';
import { searchInFiles } from '../../lib/skills/searchInFiles';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('file skills', () => {
  let tmpDir: string;
  const savedSandbox = process.env.SKILL_FILE_SANDBOX_DIR;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copharness-test-'));
    process.env.SKILL_FILE_SANDBOX_DIR = tmpDir;
  });

  afterEach(async () => {
    if (savedSandbox === undefined) delete process.env.SKILL_FILE_SANDBOX_DIR;
    else process.env.SKILL_FILE_SANDBOX_DIR = savedSandbox;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('writeFile', () => {
    it('creates and writes a file', async () => {
      const result = await writeFile.handler({ path: 'test.txt', content: 'hello' });
      expect(result.isError).toBeFalsy();
      const content = await fs.readFile(path.join(tmpDir, 'test.txt'), 'utf8');
      expect(content).toBe('hello');
    });

    it('appends when append=true', async () => {
      await writeFile.handler({ path: 'append.txt', content: 'line1\n' });
      await writeFile.handler({ path: 'append.txt', content: 'line2\n', append: true });
      const content = await fs.readFile(path.join(tmpDir, 'append.txt'), 'utf8');
      expect(content).toBe('line1\nline2\n');
    });

    it('rejects path traversal', async () => {
      const result = await writeFile.handler({ path: '../evil.txt', content: 'bad' });
      expect(result.isError).toBe(true);
    });
  });

  describe('readFile', () => {
    it('reads an existing file', async () => {
      await fs.writeFile(path.join(tmpDir, 'read.txt'), 'content here', 'utf8');
      const result = await readFile.handler({ path: 'read.txt' });
      expect(result.content).toBe('content here');
      expect(result.isError).toBeFalsy();
    });

    it('returns error for missing file', async () => {
      const result = await readFile.handler({ path: 'missing.txt' });
      expect(result.isError).toBe(true);
    });

    it('rejects path traversal', async () => {
      const result = await readFile.handler({ path: '../etc/passwd' });
      expect(result.isError).toBe(true);
    });
  });

  describe('listDirectory', () => {
    it('lists files in sandbox root', async () => {
      await fs.writeFile(path.join(tmpDir, 'a.txt'), '', 'utf8');
      await fs.writeFile(path.join(tmpDir, 'b.txt'), '', 'utf8');
      const result = await listDirectory.handler({ path: '.' });
      expect(result.content).toContain('a.txt');
      expect(result.content).toContain('b.txt');
    });

    it('returns "(empty directory)" for empty dir', async () => {
      const result = await listDirectory.handler({ path: '.' });
      expect(result.content).toBe('(empty directory)');
    });
  });

  describe('searchInFiles', () => {
    it('finds matching lines', async () => {
      await fs.writeFile(path.join(tmpDir, 'data.txt'), 'hello world\nfoo bar\nhello again', 'utf8');
      const result = await searchInFiles.handler({ pattern: 'hello' });
      expect(result.content).toContain('data.txt');
      expect(result.content).toContain('hello world');
      expect(result.content).toContain('hello again');
    });

    it('returns "No matches found." when nothing matches', async () => {
      await fs.writeFile(path.join(tmpDir, 'data.txt'), 'abc\ndef\n', 'utf8');
      const result = await searchInFiles.handler({ pattern: 'xyz' });
      expect(result.content).toBe('No matches found.');
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 4: System skills
// ---------------------------------------------------------------------------

import { getSystemInfo } from '../../lib/skills/getSystemInfo';
import { getEnvVariable } from '../../lib/skills/getEnvVariable';
import { runCommand } from '../../lib/skills/runCommand';

describe('getSystemInfo skill', () => {
  it('returns system info string', async () => {
    const result = await getSystemInfo.handler({});
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/OS:/i);
    expect(result.content).toMatch(/Memory:/i);
    expect(result.content).toMatch(/Node\.js:/i);
  });
});

describe('getEnvVariable skill', () => {
  const savedExposed = process.env.EXPOSED_ENV_VARS;
  afterEach(() => {
    if (savedExposed === undefined) delete process.env.EXPOSED_ENV_VARS;
    else process.env.EXPOSED_ENV_VARS = savedExposed;
  });

  it('returns value for allowed variable', async () => {
    process.env.EXPOSED_ENV_VARS = 'NODE_ENV';
    process.env.NODE_ENV = 'test';
    const result = await getEnvVariable.handler({ name: 'NODE_ENV' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('test');
  });

  it('rejects variables not in the allowlist', async () => {
    process.env.EXPOSED_ENV_VARS = 'NODE_ENV';
    const result = await getEnvVariable.handler({ name: 'GITHUB_TOKEN' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/not in the exposed/i);
  });

  it('returns "(not set)" for unset allowed variable', async () => {
    process.env.EXPOSED_ENV_VARS = 'SOME_UNSET_VAR_12345';
    delete process.env.SOME_UNSET_VAR_12345;
    const result = await getEnvVariable.handler({ name: 'SOME_UNSET_VAR_12345' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('(not set)');
  });
});

describe('runCommand skill', () => {
  it('runs whitelisted command echo', async () => {
    const result = await runCommand.handler({ command: 'echo', args: ['hello'] });
    expect(result.isError).toBeFalsy();
    expect(result.content.trim()).toBe('hello');
  });

  it('rejects unknown command', async () => {
    const result = await runCommand.handler({ command: 'rm' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/not allowed/i);
  });

  it('rejects dangerous argument', async () => {
    const result = await runCommand.handler({ command: 'echo', args: ['$(whoami)'] });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/disallowed characters/i);
  });
});

// ---------------------------------------------------------------------------
// Phase 5: Memory skills
// ---------------------------------------------------------------------------

import { memorySet, memoryGet, memoryList } from '../../lib/skills/memory';

describe('memory skills', () => {
  let tmpMemoryFile: string;
  const savedMemFile = process.env.SKILL_MEMORY_FILE;

  beforeEach(async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copharness-mem-'));
    tmpMemoryFile = path.join(tmpDir, 'memory.json');
    process.env.SKILL_MEMORY_FILE = tmpMemoryFile;
  });

  afterEach(async () => {
    if (savedMemFile === undefined) delete process.env.SKILL_MEMORY_FILE;
    else process.env.SKILL_MEMORY_FILE = savedMemFile;
    await fs.rm(path.dirname(tmpMemoryFile), { recursive: true, force: true });
  });

  it('set and get a value', async () => {
    await memorySet.handler({ key: 'name', value: 'Alice' });
    const result = await memoryGet.handler({ key: 'name' });
    expect(result.content).toBe('Alice');
  });

  it('list returns all stored keys', async () => {
    await memorySet.handler({ key: 'k1', value: 'v1' });
    await memorySet.handler({ key: 'k2', value: 'v2' });
    const result = await memoryList.handler({});
    expect(result.content).toContain('"k1"');
    expect(result.content).toContain('"k2"');
  });

  it('get returns "(no value stored ...)" for missing key', async () => {
    const result = await memoryGet.handler({ key: 'missing' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/no value stored/i);
  });

  it('list returns "(memory is empty)" when empty', async () => {
    const result = await memoryList.handler({});
    expect(result.content).toBe('(memory is empty)');
  });

  it('overwriting a key updates the value', async () => {
    await memorySet.handler({ key: 'x', value: 'old' });
    await memorySet.handler({ key: 'x', value: 'new' });
    const result = await memoryGet.handler({ key: 'x' });
    expect(result.content).toBe('new');
  });
});
