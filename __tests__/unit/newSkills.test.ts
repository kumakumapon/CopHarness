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
      'hashText', 'regexMatch', 'textStats', 'generatePassword', 'csvParse',
      'readFile', 'writeFile', 'listDirectory', 'searchInFiles',
      'fetchUrl', 'webSearch', 'getWeather',
      'runCommand', 'getSystemInfo', 'getEnvVariable',
      'memoryUpsert', 'memorySearch', 'memoryForget', 'memoryExplain',
      'githubSearch', 'translateText', 'sendNotification',
      'arXivSearch', 'deepResearch', 'freeResearch', 'techNews', 'githubRepo', 'youtubeInfo',
      'noteCreate', 'noteRead', 'noteList', 'noteDelete',
      'markdownToHtml', 'diffText', 'colorConvert',
      'createDocument', 'createSlideshow', 'createPresentation',
      'trendSearch', 'newsBrief',
      'rssFeed',
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

  it('listActiveSkills returns only low-risk skills when ENABLED_SKILLS is not set', () => {
    delete process.env.ENABLED_SKILLS;
    const active = listActiveSkills();
    expect(active.every((s) => (s.riskLevel ?? 'low') === 'low')).toBe(true);
    expect(active.map((s) => s.name)).not.toContain('runCommand');
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

  it('resolveSkills returns requested low-risk skills when ENABLED_SKILLS is empty string', () => {
    process.env.ENABLED_SKILLS = '';
    const result = resolveSkills(['currentDateTime', 'calculator', 'runCommand']);
    expect(result.map((s) => s.name)).toEqual(['currentDateTime', 'calculator']);
  });

  it('resolveSkills allows high-risk skills only when explicitly enabled', () => {
    process.env.ENABLED_SKILLS = 'runCommand';
    const result = resolveSkills(['runCommand']);
    expect(result.map((s) => s.name)).toEqual(['runCommand']);
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
  const savedNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (savedExposed === undefined) delete process.env.EXPOSED_ENV_VARS;
    else process.env.EXPOSED_ENV_VARS = savedExposed;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: savedNodeEnv,
      configurable: true,
      writable: true,
    });
  });

  it('returns value for allowed variable', async () => {
    process.env.EXPOSED_ENV_VARS = 'NODE_ENV';
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'test',
      configurable: true,
      writable: true,
    });
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

// ---------------------------------------------------------------------------
// New utility skills
// ---------------------------------------------------------------------------

import { hashText } from '../../lib/skills/hashText';
import { regexMatch } from '../../lib/skills/regexMatch';
import { textStats } from '../../lib/skills/textStats';
import { generatePassword } from '../../lib/skills/generatePassword';
import { csvParse } from '../../lib/skills/csvParse';

describe('hashText skill', () => {
  it('computes sha256 hash of empty string', async () => {
    const result = await hashText.handler({ text: '' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('computes sha256 hash of known input', async () => {
    const result = await hashText.handler({ text: 'hello', algorithm: 'sha256' });
    expect(result.content).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('computes md5 hash', async () => {
    const result = await hashText.handler({ text: 'hello', algorithm: 'md5' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('defaults to sha256', async () => {
    const withDefault = await hashText.handler({ text: 'test' });
    const withExplicit = await hashText.handler({ text: 'test', algorithm: 'sha256' });
    expect(withDefault.content).toBe(withExplicit.content);
  });

  it('returns error for unsupported algorithm', async () => {
    const result = await hashText.handler({ text: 'x', algorithm: 'crc32' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/unsupported algorithm/i);
  });
});

describe('regexMatch skill', () => {
  it('finds all matches', async () => {
    const result = await regexMatch.handler({ text: 'cat bat hat', pattern: '[a-z]at' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('3 match(es)');
    expect(result.content).toContain('"cat"');
    expect(result.content).toContain('"bat"');
    expect(result.content).toContain('"hat"');
  });

  it('returns "No matches found." when nothing matches', async () => {
    const result = await regexMatch.handler({ text: 'hello', pattern: '\\d+' });
    expect(result.content).toBe('No matches found.');
  });

  it('supports case-insensitive flag', async () => {
    const result = await regexMatch.handler({ text: 'Hello HELLO hello', pattern: 'hello', flags: 'gi' });
    expect(result.content).toContain('3 match(es)');
  });

  it('returns error for invalid regex', async () => {
    const result = await regexMatch.handler({ text: 'abc', pattern: '[invalid' });
    expect(result.isError).toBe(true);
  });

  it('returns error when pattern is empty', async () => {
    const result = await regexMatch.handler({ text: 'abc', pattern: '' });
    expect(result.isError).toBe(true);
  });
});

describe('textStats skill', () => {
  it('returns correct stats for a simple sentence', async () => {
    const result = await textStats.handler({ text: 'Hello world! Foo bar.' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Words: 4');
    expect(result.content).toContain('Sentences: 2');
  });

  it('handles empty string', async () => {
    const result = await textStats.handler({ text: '' });
    expect(result.content).toContain('Characters (with spaces): 0');
    expect(result.content).toContain('Words: 0');
    expect(result.content).toContain('Lines: 0');
  });

  it('counts lines correctly', async () => {
    const result = await textStats.handler({ text: 'line1\nline2\nline3' });
    expect(result.content).toContain('Lines: 3');
  });
});

describe('generatePassword skill', () => {
  it('generates a password of default length 16', async () => {
    const result = await generatePassword.handler({});
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(16);
  });

  it('respects custom length', async () => {
    const result = await generatePassword.handler({ length: 32 });
    expect(result.content).toHaveLength(32);
  });

  it('clamps length to minimum 8', async () => {
    const result = await generatePassword.handler({ length: 2 });
    expect(result.content).toHaveLength(8);
  });

  it('clamps length to maximum 128', async () => {
    const result = await generatePassword.handler({ length: 999 });
    expect(result.content).toHaveLength(128);
  });

  it('generates only lowercase letters when all other classes are disabled', async () => {
    const result = await generatePassword.handler({
      length: 20,
      includeUppercase: false,
      includeDigits: false,
      includeSymbols: false,
    });
    expect(result.content).toMatch(/^[a-z]+$/);
  });

  it('two calls produce different passwords', async () => {
    const a = await generatePassword.handler({ length: 24 });
    const b = await generatePassword.handler({ length: 24 });
    // Extremely unlikely to collide
    expect(a.content).not.toBe(b.content);
  });
});

describe('csvParse skill', () => {
  it('parses simple CSV with header', async () => {
    const result = await csvParse.handler({ csv: 'name,age\nAlice,30\nBob,25' });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content) as Array<Record<string, string>>;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ name: 'Alice', age: '30' });
    expect(data[1]).toEqual({ name: 'Bob', age: '25' });
  });

  it('parses CSV without header into array of arrays', async () => {
    const result = await csvParse.handler({ csv: 'a,b\nc,d', hasHeader: false });
    const data = JSON.parse(result.content) as string[][];
    expect(data[0]).toEqual(['a', 'b']);
    expect(data[1]).toEqual(['c', 'd']);
  });

  it('handles quoted fields', async () => {
    const result = await csvParse.handler({ csv: 'name,bio\nAlice,"Hello, world"' });
    const data = JSON.parse(result.content) as Array<Record<string, string>>;
    expect(data[0].bio).toBe('Hello, world');
  });

  it('handles custom delimiter', async () => {
    const result = await csvParse.handler({ csv: 'x;y\n1;2', delimiter: ';' });
    const data = JSON.parse(result.content) as Array<Record<string, string>>;
    expect(data[0]).toEqual({ x: '1', y: '2' });
  });

  it('returns empty array for empty input', async () => {
    const result = await csvParse.handler({ csv: '' });
    expect(result.content).toBe('[]');
  });
});

// ---------------------------------------------------------------------------
// Phase 7: Extended skills
// ---------------------------------------------------------------------------

import { diffText } from '../../lib/skills/diffText';
import { colorConvert } from '../../lib/skills/colorConvert';
import { markdownToHtmlSkill } from '../../lib/skills/markdownToHtml';
import { noteCreate, noteRead, noteList, noteDelete } from '../../lib/skills/notes';

describe('diffText skill', () => {
  it('reports identical texts', async () => {
    const result = await diffText.handler({ oldText: 'hello', newText: 'hello' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('identical');
  });

  it('detects added lines', async () => {
    const result = await diffText.handler({ oldText: 'line1', newText: 'line1\nline2' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('+');
    expect(result.content).toContain('1 line(s) added');
  });

  it('detects removed lines', async () => {
    const result = await diffText.handler({ oldText: 'line1\nline2', newText: 'line1' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('-');
    expect(result.content).toContain('1 line(s) removed');
  });

  it('shows context lines around changes', async () => {
    const old = 'a\nb\nc\nd\ne';
    const newT = 'a\nb\nX\nd\ne';
    const result = await diffText.handler({ oldText: old, newText: newT, contextLines: 1 });
    expect(result.content).toContain('b');
    expect(result.content).toContain('d');
    expect(result.content).toContain('X');
  });

  it('returns error when oldText is missing', async () => {
    const result = await diffText.handler({ newText: 'abc' });
    // Should still run (empty old = all additions)
    expect(result.isError).toBeFalsy();
  });
});

describe('colorConvert skill', () => {
  it('converts HEX to RGB and HSL', async () => {
    const result = await colorConvert.handler({ color: '#ff6347' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('rgb(255, 99, 71)');
    expect(result.content).toContain('hsl(');
  });

  it('converts 3-digit HEX', async () => {
    const result = await colorConvert.handler({ color: '#fff' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('rgb(255, 255, 255)');
  });

  it('converts RGB input', async () => {
    const result = await colorConvert.handler({ color: '255,0,0' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('#ff0000');
    expect(result.content).toContain('hsl(0,');
  });

  it('converts HSL input', async () => {
    const result = await colorConvert.handler({ color: 'hsl(0, 100%, 50%)' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('rgb(255, 0, 0)');
  });

  it('returns error for invalid color', async () => {
    const result = await colorConvert.handler({ color: 'notacolor' });
    expect(result.isError).toBe(true);
  });

  it('returns error when color is empty', async () => {
    const result = await colorConvert.handler({ color: '' });
    expect(result.isError).toBe(true);
  });
});

describe('markdownToHtml skill', () => {
  it('converts a heading', async () => {
    const result = await markdownToHtmlSkill.handler({ markdown: '# Hello' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('<h1>Hello</h1>');
  });

  it('converts bold and italic', async () => {
    const result = await markdownToHtmlSkill.handler({ markdown: '**bold** and *italic*' });
    expect(result.content).toContain('<strong>bold</strong>');
    expect(result.content).toContain('<em>italic</em>');
  });

  it('converts a fenced code block', async () => {
    const result = await markdownToHtmlSkill.handler({ markdown: '```js\nconsole.log("hi");\n```' });
    expect(result.content).toContain('<pre><code');
    expect(result.content).toContain('console.log');
  });

  it('converts unordered list', async () => {
    const result = await markdownToHtmlSkill.handler({ markdown: '- item1\n- item2' });
    expect(result.content).toContain('<ul>');
    expect(result.content).toContain('<li>item1</li>');
  });

  it('converts a link', async () => {
    const result = await markdownToHtmlSkill.handler({ markdown: '[GitHub](https://github.com)' });
    expect(result.content).toContain('<a href="https://github.com">GitHub</a>');
  });

  it('returns error for empty input', async () => {
    const result = await markdownToHtmlSkill.handler({ markdown: '' });
    expect(result.isError).toBe(true);
  });

  it('wraps output in a full HTML document', async () => {
    const result = await markdownToHtmlSkill.handler({ markdown: 'hello' });
    expect(result.content).toContain('<!DOCTYPE html>');
    expect(result.content).toContain('</html>');
  });
});

describe('note skills (noteCreate / noteRead / noteList / noteDelete)', () => {
  const origEnv = process.env.SKILL_NOTES_FILE;

  beforeEach(() => {
    // Use a temp path to avoid polluting real notes.json
    process.env.SKILL_NOTES_FILE = `/tmp/test-notes-${Date.now()}.json`;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.SKILL_NOTES_FILE;
    else process.env.SKILL_NOTES_FILE = origEnv;
  });

  it('creates a note and lists it', async () => {
    const created = await noteCreate.handler({ title: 'Test Note', content: 'Hello world', tags: 'test,unit' });
    expect(created.isError).toBeFalsy();
    expect(created.content).toContain('Test Note');

    const listed = await noteList.handler({});
    expect(listed.isError).toBeFalsy();
    expect(listed.content).toContain('Test Note');
  });

  it('reads a note by keyword', async () => {
    await noteCreate.handler({ title: 'Meeting Notes', content: 'Discussed quarterly goals.' });
    const result = await noteRead.handler({ keyword: 'quarterly' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Discussed quarterly goals.');
  });

  it('reads a note by ID', async () => {
    const created = await noteCreate.handler({ title: 'By ID', content: 'Content here' });
    const idMatch = created.content.match(/ID:\s*([\w-]+)/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1];
    const result = await noteRead.handler({ id });
    expect(result.content).toContain('Content here');
  });

  it('deletes a note', async () => {
    const created = await noteCreate.handler({ title: 'Delete Me', content: 'temporary' });
    const idMatch = created.content.match(/ID:\s*([\w-]+)/);
    const id = idMatch![1];
    const deleted = await noteDelete.handler({ id });
    expect(deleted.isError).toBeFalsy();
    expect(deleted.content).toContain('Deleted');
    const result = await noteRead.handler({ id });
    expect(result.content).toContain('No note found');
  });

  it('filters noteList by tag', async () => {
    await noteCreate.handler({ title: 'Work Note', content: 'Work content', tags: 'work' });
    await noteCreate.handler({ title: 'Personal Note', content: 'Personal content', tags: 'personal' });
    const result = await noteList.handler({ tag: 'work' });
    expect(result.content).toContain('Work Note');
    expect(result.content).not.toContain('Personal Note');
  });

  it('returns error for noteCreate without title', async () => {
    const result = await noteCreate.handler({ content: 'no title' });
    expect(result.isError).toBe(true);
  });

  it('returns error for noteRead without id or keyword', async () => {
    const result = await noteRead.handler({});
    expect(result.isError).toBe(true);
  });

  it('returns error for noteDelete without id', async () => {
    const result = await noteDelete.handler({});
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 8: Web news / trend skills
// ---------------------------------------------------------------------------

import { techNews, FEEDS, NEWS_TOPICS, fetchFeedItems } from '../../lib/skills/techNews';
import { trendSearch } from '../../lib/skills/trendSearch';
import { newsBrief } from '../../lib/skills/newsBrief';

// Minimal RSS 2.0 XML helper
function makeRss(items: Array<{ title: string; link: string; pubDate: string; description: string }>): string {
  const itemXml = items
    .map(
      (it) =>
        `<item><title>${it.title}</title><link>${it.link}</link>` +
        `<pubDate>${it.pubDate}</pubDate><description>${it.description}</description></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel>${itemXml}</channel></rss>`;
}

// Minimal Google Trends RSS helper
function makeTrendsRss(trends: Array<{ keyword: string; traffic: string; newsTitle: string }>): string {
  const items = trends
    .map(
      (t) =>
        `<item><title>${t.keyword}</title>` +
        `<ht:approx_traffic>${t.traffic}</ht:approx_traffic>` +
        `<ht:news_item><ht:news_item_title>${t.newsTitle}</ht:news_item_title></ht:news_item>` +
        `<link>https://trends.google.com/trends/explore?q=${encodeURIComponent(t.keyword)}</link></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0" xmlns:ht="https://trends.google.com/trends/trendingsearches/daily"><channel>${items}</channel></rss>`;
}

// ---------------------------------------------------------------------------
// FEEDS & NEWS_TOPICS exports
// ---------------------------------------------------------------------------

describe('FEEDS and NEWS_TOPICS exports', () => {
  it('NEWS_TOPICS contains original three topics', () => {
    expect(NEWS_TOPICS).toContain('ai');
    expect(NEWS_TOPICS).toContain('tech');
    expect(NEWS_TOPICS).toContain('dev');
  });

  it('NEWS_TOPICS contains the four new topics', () => {
    expect(NEWS_TOPICS).toContain('world');
    expect(NEWS_TOPICS).toContain('finance');
    expect(NEWS_TOPICS).toContain('science');
    expect(NEWS_TOPICS).toContain('japan');
  });

  it('every topic in NEWS_TOPICS has at least one feed in FEEDS', () => {
    for (const topic of NEWS_TOPICS) {
      expect(FEEDS[topic]).toBeDefined();
      expect(FEEDS[topic].length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// fetchFeedItems helper
// ---------------------------------------------------------------------------

describe('fetchFeedItems helper', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('sorts items newest-first by pubDate', async () => {
    const older = makeRss([
      { title: 'Old', link: 'https://a.com', pubDate: 'Mon, 01 Jan 2024 00:00:00 +0000', description: '' },
    ]);
    const newer = makeRss([
      { title: 'New', link: 'https://b.com', pubDate: 'Tue, 01 Jan 2025 00:00:00 +0000', description: '' },
    ]);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(older, { status: 200 }))
      .mockResolvedValueOnce(new Response(newer, { status: 200 }));

    const items = await fetchFeedItems([
      { url: 'https://a.com/feed', name: 'Source A' },
      { url: 'https://b.com/feed', name: 'Source B' },
    ]);
    expect(items[0].title).toBe('New');
    expect(items[1].title).toBe('Old');
  });

  it('silently skips failed feeds', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network error'));
    const items = await fetchFeedItems([{ url: 'https://fail.example', name: 'Fail' }]);
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// techNews skill — metadata & handler
// ---------------------------------------------------------------------------

describe('techNews skill metadata', () => {
  it('has correct name', () => {
    expect(techNews.name).toBe('techNews');
  });

  it('has category "web" and riskLevel "low"', () => {
    expect(techNews.category).toBe('web');
    expect(techNews.riskLevel).toBe('low');
  });

  it('description mentions all seven topics', () => {
    const desc = techNews.description;
    for (const topic of ['ai', 'tech', 'dev', 'world', 'finance', 'science', 'japan']) {
      expect(desc).toContain(`"${topic}"`);
    }
  });

  it('parameter enum includes all NEWS_TOPICS', () => {
    const topicProp = techNews.parameters.properties['topic'];
    expect(topicProp).toBeDefined();
    expect(topicProp!.enum).toEqual(expect.arrayContaining(NEWS_TOPICS));
  });
});

describe('techNews skill handler', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns formatted news items', async () => {
    const rss = makeRss([
      { title: 'AI Breakthrough', link: 'https://example.com/1', pubDate: 'Mon, 01 Jan 2025 10:00:00 +0000', description: 'Details here.' },
      { title: 'Another Story', link: 'https://example.com/2', pubDate: 'Mon, 01 Jan 2025 09:00:00 +0000', description: 'More details.' },
    ]);
    (global.fetch as jest.Mock)
      .mockResolvedValue(new Response(rss, { status: 200 }));

    const result = await techNews.handler({ topic: 'ai', maxResults: 2 });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('AI Breakthrough');
    expect(result.content).toContain('AI');
  });

  it('defaults to topic "ai" for unknown topic', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(makeRss([{ title: 'AI News', link: 'https://a.com', pubDate: '', description: '' }]), { status: 200 }),
    );
    const result = await techNews.handler({ topic: 'unknown' });
    expect(result.isError).toBeFalsy();
  });

  it('returns no-items message when feeds are unavailable', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('timeout'));
    const result = await techNews.handler({ topic: 'world' });
    expect(result.content).toMatch(/No news items found/);
    expect(result.isError).toBeFalsy();
  });

  it('handles new topic "japan"', async () => {
    const rss = makeRss([
      { title: 'Japan News', link: 'https://nhk.example', pubDate: 'Mon, 01 Jan 2025 08:00:00 +0000', description: 'News from Japan.' },
    ]);
    (global.fetch as jest.Mock).mockResolvedValue(new Response(rss, { status: 200 }));
    const result = await techNews.handler({ topic: 'japan', maxResults: 1 });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('JAPAN');
    expect(result.content).toContain('Japan News');
  });
});

// ---------------------------------------------------------------------------
// trendSearch skill
// ---------------------------------------------------------------------------

describe('trendSearch skill metadata', () => {
  it('has correct name, category, and riskLevel', () => {
    expect(trendSearch.name).toBe('trendSearch');
    expect(trendSearch.category).toBe('web');
    expect(trendSearch.riskLevel).toBe('low');
  });

  it('has no required parameters', () => {
    expect(trendSearch.parameters.required ?? []).toHaveLength(0);
  });
});

describe('trendSearch skill handler', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns trending topics from Google Trends RSS', async () => {
    const xml = makeTrendsRss([
      { keyword: 'TypeScript', traffic: '200K+', newsTitle: 'TypeScript 6 Released' },
      { keyword: 'AI regulation', traffic: '100K+', newsTitle: 'EU AI Act Update' },
    ]);
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(xml, { status: 200 }));

    const result = await trendSearch.handler({ region: 'JP', maxResults: 5 });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('🔥');
    expect(result.content).toContain('TypeScript');
    expect(result.content).toContain('200K+');
    expect(result.content).toContain('TypeScript 6 Released');
  });

  it('defaults to region JP when region is not provided', async () => {
    const xml = makeTrendsRss([{ keyword: 'Sakura', traffic: '50K+', newsTitle: 'Cherry blossoms bloom' }]);
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(xml, { status: 200 }));

    const result = await trendSearch.handler({});
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('JP');
  });

  it('uppercases and truncates region to 2 chars', async () => {
    const xml = makeTrendsRss([{ keyword: 'Foo', traffic: '1K+', newsTitle: 'Foo news' }]);
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(xml, { status: 200 }));

    const result = await trendSearch.handler({ region: 'us' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('US');
  });

  it('returns error when API returns non-200', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response('', { status: 429, statusText: 'Too Many Requests' }));
    const result = await trendSearch.handler({ region: 'US' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('429');
  });

  it('returns error on network failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('fetch failed'));
    const result = await trendSearch.handler({ region: 'JP' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('fetch failed');
  });

  it('returns no-trends message when RSS is empty', async () => {
    const emptyRss = `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`;
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(emptyRss, { status: 200 }));
    const result = await trendSearch.handler({ region: 'XX' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/No trending topics|not available/i);
  });

  it('respects maxResults limit', async () => {
    const xml = makeTrendsRss(
      Array.from({ length: 20 }, (_, i) => ({ keyword: `Trend${i}`, traffic: '1K+', newsTitle: `News ${i}` })),
    );
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(xml, { status: 200 }));
    const result = await trendSearch.handler({ maxResults: 3 });
    // Should contain exactly 3 numbered items
    const matches = result.content.match(/^\d+\./gm);
    expect(matches).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// newsBrief skill
// ---------------------------------------------------------------------------

describe('newsBrief skill metadata', () => {
  it('has correct name, category, and riskLevel', () => {
    expect(newsBrief.name).toBe('newsBrief');
    expect(newsBrief.category).toBe('web');
    expect(newsBrief.riskLevel).toBe('low');
  });

  it('description is present', () => {
    expect(newsBrief.description.length).toBeGreaterThan(0);
  });

  it('has no required parameters', () => {
    expect(newsBrief.parameters.required ?? []).toHaveLength(0);
  });
});

describe('newsBrief skill handler', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns digest for multiple topics', async () => {
    const aiRss = makeRss([
      { title: 'AI Story', link: 'https://ai.example', pubDate: 'Mon, 01 Jan 2025 10:00:00 +0000', description: 'AI news.' },
    ]);
    const techRss = makeRss([
      { title: 'Tech Story', link: 'https://tech.example', pubDate: 'Mon, 01 Jan 2025 09:00:00 +0000', description: 'Tech news.' },
    ]);
    // ai topic has 2 feeds, tech topic has 2 feeds → 4 fetch calls
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(aiRss, { status: 200 }))
      .mockResolvedValueOnce(new Response(aiRss, { status: 200 }))
      .mockResolvedValueOnce(new Response(techRss, { status: 200 }))
      .mockResolvedValueOnce(new Response(techRss, { status: 200 }));

    const result = await newsBrief.handler({ topics: ['ai', 'tech'], maxResults: 1 });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('📋');
    expect(result.content).toContain('AI');
    expect(result.content).toContain('TECH');
    expect(result.content).toContain('AI Story');
    expect(result.content).toContain('Tech Story');
  });

  it('defaults to ["ai", "tech"] when topics is an empty array', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(makeRss([{ title: 'Item', link: 'https://x.com', pubDate: '', description: '' }]), { status: 200 }),
    );
    const result = await newsBrief.handler({ topics: [] });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('AI');
    expect(result.content).toContain('TECH');
  });

  it('ignores invalid topic names', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(makeRss([{ title: 'Item', link: 'https://x.com', pubDate: '', description: '' }]), { status: 200 }),
    );
    const result = await newsBrief.handler({ topics: ['invalid_topic', 'ai'] });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('AI');
    expect(result.content).not.toContain('INVALID_TOPIC');
  });

  it('shows "(No items available)" for a topic where feeds fail', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network error'));
    const result = await newsBrief.handler({ topics: ['world'], maxResults: 2 });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('No items available');
  });

  it('respects maxPerTopic limit', async () => {
    const rss = makeRss(
      Array.from({ length: 10 }, (_, i) => ({
        title: `Story ${i}`,
        link: `https://x.com/${i}`,
        pubDate: `Mon, 0${(i % 9) + 1} Jan 2025 00:00:00 +0000`,
        description: '',
      })),
    );
    (global.fetch as jest.Mock).mockResolvedValue(new Response(rss, { status: 200 }));
    const result = await newsBrief.handler({ topics: ['dev'], maxResults: 2 });
    // dev has 2 feeds; each returns 10 items; we cap at 2 per topic
    const storyMatches = result.content.match(/Story \d/g) ?? [];
    expect(storyMatches.length).toBeLessThanOrEqual(2);
  });

  it('total items count in header matches actual items', async () => {
    const rss = makeRss([
      { title: 'Item A', link: 'https://a.com', pubDate: 'Mon, 01 Jan 2025 10:00:00 +0000', description: '' },
    ]);
    (global.fetch as jest.Mock).mockResolvedValue(new Response(rss, { status: 200 }));
    const result = await newsBrief.handler({ topics: ['ai'], maxResults: 1 });
    expect(result.content).toMatch(/\d+ items total/);
  });
});

// ---------------------------------------------------------------------------
// deepResearch skill
// ---------------------------------------------------------------------------

import { deepResearch } from '../../lib/skills/deepResearch';

describe('deepResearch skill metadata', () => {
  it('has correct name, category, and riskLevel', () => {
    expect(deepResearch.name).toBe('deepResearch');
    expect(deepResearch.category).toBe('web');
    expect(deepResearch.riskLevel).toBe('low');
  });

  it('does not require any external API key env var', () => {
    expect(deepResearch.requiresEnv ?? []).toHaveLength(0);
  });

  it('query parameter is required', () => {
    expect(deepResearch.parameters.required).toContain('query');
  });
});

describe('deepResearch skill handler', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  function makeDdgResponse(answer?: string, abstract?: string) {
    const data: Record<string, string> = {};
    if (answer) data.Answer = answer;
    if (abstract) data.Abstract = abstract;
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function makeWikiSearchResponse(titles: string[]) {
    return new Response(
      JSON.stringify({
        query: {
          search: titles.map((title) => ({ title, snippet: `snippet for ${title}` })),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  function makeWikiSummaryResponse(title: string, extract: string) {
    return new Response(
      JSON.stringify({
        title,
        extract,
        content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` } },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('returns error when query is empty', async () => {
    const result = await deepResearch.handler({ query: '' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/query is required/);
  });

  it('returns structured report for a single query', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(makeDdgResponse(undefined, 'TypeScript is a typed superset of JavaScript.'))
      .mockResolvedValueOnce(makeWikiSearchResponse(['TypeScript']))
      .mockResolvedValueOnce(makeWikiSummaryResponse('TypeScript', 'TypeScript is a programming language developed at Microsoft.'));

    const result = await deepResearch.handler({ query: 'TypeScript overview' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('# Free Research: TypeScript overview');
    expect(result.content).toContain('TypeScript is a typed superset of JavaScript.');
    expect(result.content).toContain('TypeScript');
    expect(result.content).toContain('wikipedia.org');
  });

  it('runs sub-queries and deduplicates Wikipedia sources', async () => {
    // Call order: DDG(main), WikiSearch(main), WikiSummary(SharedArticle),
    //             WikiSearch(sub), WikiSummary(UniqueArticle)
    // Note: freeResearch only calls DDG for the main query
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(makeDdgResponse(undefined, 'Main answer.'))
      .mockResolvedValueOnce(makeWikiSearchResponse(['Shared Article']))
      .mockResolvedValueOnce(makeWikiSummaryResponse('Shared Article', 'Shared content.'))
      .mockResolvedValueOnce(makeWikiSearchResponse(['Shared Article', 'Unique Article']))
      .mockResolvedValueOnce(makeWikiSummaryResponse('Unique Article', 'Unique content.'));

    const result = await deepResearch.handler({ query: 'main topic', subQueries: 'sub angle' });
    expect(result.isError).toBeFalsy();
    // Shared article should appear only once
    const sharedMatches = (result.content.match(/Shared Article/g) ?? []).length;
    expect(sharedMatches).toBe(1);
    // DuckDuckGo answer present (main query only)
    expect(result.content).toContain('Main answer.');
    // Unique article present
    expect(result.content).toContain('Unique Article');
  });

  it('caps sub-queries at 3', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await deepResearch.handler({
      query: 'main',
      subQueries: 'q1, q2, q3, q4, q5',
    });
    // DDG is called once (main query only); Wikipedia search is called
    // for main + max 3 sub-queries = 4 Wikipedia search calls
    const wikiCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => String(url).includes('wikipedia.org/w/api.php'),
    );
    expect(wikiCalls.length).toBe(4);
  });

  it('includes sections headers in output', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(makeDdgResponse(undefined, 'Summary answer.'))
      .mockResolvedValueOnce(makeWikiSearchResponse(['Source A', 'Source B']))
      .mockResolvedValueOnce(makeWikiSummaryResponse('Source A', 'Content A'))
      .mockResolvedValueOnce(makeWikiSummaryResponse('Source B', 'Content B'));

    const result = await deepResearch.handler({ query: 'test' });
    expect(result.content).toContain('## DuckDuckGo');
    expect(result.content).toContain('## Wikipedia');
  });

  it('handles fetch errors gracefully and returns available results', async () => {
    // DDG fails for main query; Wikipedia search and summary succeed
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(makeWikiSearchResponse(['Main Article']))
      .mockResolvedValueOnce(makeWikiSummaryResponse('Main Article', 'Main content.'));

    const result = await deepResearch.handler({ query: 'test query' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Main Article');
  });

  it('returns no results message when all fetches fail', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const result = await deepResearch.handler({ query: 'impossible query' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('No information found for:');
  });
});

// ---------------------------------------------------------------------------
// freeResearch skill
// ---------------------------------------------------------------------------

import { freeResearch } from '../../lib/skills/freeResearch';

describe('freeResearch skill metadata', () => {
  it('has correct name, category, and riskLevel', () => {
    expect(freeResearch.name).toBe('freeResearch');
    expect(freeResearch.category).toBe('web');
    expect(freeResearch.riskLevel).toBe('low');
  });

  it('has no requiresEnv', () => {
    expect(freeResearch.requiresEnv ?? []).toHaveLength(0);
  });

  it('query parameter is required', () => {
    expect(freeResearch.parameters.required).toContain('query');
  });

  it('language parameter has an enum', () => {
    const langProp = freeResearch.parameters.properties['language'];
    expect(langProp).toBeDefined();
    expect(langProp!.enum).toContain('en');
    expect(langProp!.enum).toContain('ja');
  });
});

describe('freeResearch skill handler', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterEach(() => {
    jest.resetAllMocks();
  });

  function makeDdgResponse(overrides: Record<string, unknown> = {}) {
    const base = {
      Abstract: 'TypeScript is a typed superset of JavaScript.',
      AbstractURL: 'https://en.wikipedia.org/wiki/TypeScript',
      AbstractSource: 'Wikipedia',
      Answer: '',
      Definition: '',
      RelatedTopics: [
        { Text: 'TypeScript 5.0 released', FirstURL: 'https://ddg.gg/?q=TypeScript+5.0' },
        { Text: 'TypeScript vs JavaScript', FirstURL: 'https://ddg.gg/?q=ts+vs+js' },
      ],
      Results: [],
      Type: 'A',
    };
    return new Response(JSON.stringify({ ...base, ...overrides }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function makeWikiSearch(titles: string[]) {
    const search = titles.map((t, i) => ({ title: t, snippet: `Snippet for ${t}`, pageid: i + 1 }));
    return new Response(
      JSON.stringify({ query: { search } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  function makeWikiSummary(title: string, extract: string, pageUrl: string) {
    return new Response(
      JSON.stringify({ title, extract, content_urls: { desktop: { page: pageUrl } } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('returns error when query is empty', async () => {
    const result = await freeResearch.handler({ query: '' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/query is required/);
  });

  it('returns structured report with DuckDuckGo + Wikipedia content', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(makeDdgResponse())                                       // DDG
      .mockResolvedValueOnce(makeWikiSearch(['TypeScript']))                           // Wikipedia search
      .mockResolvedValueOnce(makeWikiSummary('TypeScript', 'TS is great.', 'https://en.wikipedia.org/wiki/TypeScript'));  // Wiki summary

    const result = await freeResearch.handler({ query: 'TypeScript' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('# Free Research: TypeScript');
    expect(result.content).toContain('DuckDuckGo');
    expect(result.content).toContain('TypeScript is a typed superset of JavaScript.');
    expect(result.content).toContain('Wikipedia');
    expect(result.content).toContain('TS is great.');
  });

  it('includes DuckDuckGo instant answer when present', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(makeDdgResponse({ Answer: '42', AnswerType: 'calc' }))
      .mockResolvedValueOnce(makeWikiSearch([]))
    ;

    const result = await freeResearch.handler({ query: '6 * 7' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('42');
  });

  it('includes DuckDuckGo related topics', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(makeDdgResponse())
      .mockResolvedValueOnce(makeWikiSearch([]));

    const result = await freeResearch.handler({ query: 'TypeScript' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Related Topics');
    expect(result.content).toContain('TypeScript 5.0 released');
  });

  it('uses the specified language for Wikipedia', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(makeDdgResponse())
      .mockResolvedValueOnce(makeWikiSearch(['TypeScript']))
      .mockResolvedValueOnce(makeWikiSummary('TypeScript', 'TSはJavaScriptのスーパーセット。', 'https://ja.wikipedia.org/wiki/TypeScript'));

    const result = await freeResearch.handler({ query: 'TypeScript', language: 'ja' });
    expect(result.isError).toBeFalsy();
    // The Wikipedia API URL should have used ja.wikipedia.org
    const calls = (global.fetch as jest.Mock).mock.calls as [string, ...unknown[]][];
    const wikiCall = calls.find(([url]) => {
      try { return new URL(String(url)).hostname === 'ja.wikipedia.org'; } catch { return false; }
    });
    expect(wikiCall).toBeDefined();
    expect(result.content).toContain('TSはJavaScriptのスーパーセット。');
  });

  it('continues gracefully when DuckDuckGo fails', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('DDG network error'))                          // DDG fails
      .mockResolvedValueOnce(makeWikiSearch(['TypeScript']))                           // Wikipedia search
      .mockResolvedValueOnce(makeWikiSummary('TypeScript', 'TS summary.', 'https://en.wikipedia.org/wiki/TypeScript'));

    const result = await freeResearch.handler({ query: 'TypeScript' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('TS summary.');
  });

  it('continues gracefully when Wikipedia search fails', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(makeDdgResponse())
      .mockRejectedValueOnce(new Error('Wikipedia network error'));

    const result = await freeResearch.handler({ query: 'TypeScript' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('TypeScript is a typed superset of JavaScript.');
  });

  it('returns no-info message when all sources fail', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network error'));

    const result = await freeResearch.handler({ query: 'obscure topic xyz' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/No information found/);
  });

  it('respects maxWikiResults limit', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(makeDdgResponse({ Abstract: '', RelatedTopics: [] }))
      .mockResolvedValueOnce(makeWikiSearch(['Page A', 'Page B', 'Page C']))
      .mockResolvedValueOnce(makeWikiSummary('Page A', 'Extract A.', 'https://en.wikipedia.org/wiki/Page_A'))
      .mockResolvedValueOnce(makeWikiSummary('Page B', 'Extract B.', 'https://en.wikipedia.org/wiki/Page_B'));
    // maxWikiResults=2, so only 2 summary fetches happen

    const result = await freeResearch.handler({ query: 'test', maxWikiResults: 2 });
    expect(result.isError).toBeFalsy();
    // Verify only 2 summary calls were made (1 DDG + 1 wiki search + 2 summaries = 4 total)
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(4);
    expect(result.content).toContain('Extract A.');
    expect(result.content).toContain('Extract B.');
    expect(result.content).not.toContain('Extract C.');
  });

  it('handles nested RelatedTopics with Topics sub-array', async () => {
    const ddg = {
      Abstract: 'Test abstract.',
      AbstractURL: 'https://ddg.gg',
      AbstractSource: 'Test',
      Answer: '',
      Definition: '',
      RelatedTopics: [
        {
          Topics: [
            { Text: 'Nested topic A', FirstURL: 'https://ddg.gg/a' },
            { Text: 'Nested topic B', FirstURL: 'https://ddg.gg/b' },
          ],
        },
      ],
      Results: [],
      Type: 'C',
    };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(JSON.stringify(ddg), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(makeWikiSearch([]));

    const result = await freeResearch.handler({ query: 'nested test' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Nested topic A');
    expect(result.content).toContain('Nested topic B');
  });
});

// ---------------------------------------------------------------------------
// rssFeed skill
// ---------------------------------------------------------------------------

import { rssFeed } from '../../lib/skills/rssFeed';

describe('rssFeed skill metadata', () => {
  it('has correct name, category, and riskLevel', () => {
    expect(rssFeed.name).toBe('rssFeed');
    expect(rssFeed.category).toBe('web');
    expect(rssFeed.riskLevel).toBe('low');
  });

  it('url parameter is required', () => {
    expect(rssFeed.parameters.required).toContain('url');
  });

  it('description mentions RSS and scheduling', () => {
    expect(rssFeed.description).toMatch(/RSS/i);
    expect(rssFeed.description).toMatch(/schedul/i);
  });

  it('has maxItems and summarize parameters', () => {
    expect(rssFeed.parameters.properties['maxItems']).toBeDefined();
    expect(rssFeed.parameters.properties['summarize']).toBeDefined();
  });
});

describe('rssFeed skill handler', () => {
  const savedApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    global.fetch = jest.fn();
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    jest.resetAllMocks();
    if (savedApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedApiKey;
  });

  it('returns error when url is missing', async () => {
    const result = await rssFeed.handler({});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('url is required');
  });

  it('returns error for non-http URLs', async () => {
    const result = await rssFeed.handler({ url: 'ftp://example.com/feed' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('only http');
  });

  it('returns error when fetch fails', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network error'));
    const result = await rssFeed.handler({ url: 'https://example.com/feed.rss' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error fetching feed');
  });

  it('returns error message when HTTP response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(new Response('Not Found', { status: 404 }));
    const result = await rssFeed.handler({ url: 'https://example.com/feed.rss' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Error fetching feed');
    expect(result.content).toContain('404');
  });

  it('returns "No items found" for empty feed', async () => {
    const emptyFeed = `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`;
    (global.fetch as jest.Mock).mockResolvedValue(new Response(emptyFeed, { status: 200 }));
    const result = await rssFeed.handler({ url: 'https://example.com/feed.rss' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('No items found');
  });

  it('returns formatted feed items with title and link', async () => {
    const rss = makeRss([
      { title: 'Hello World', link: 'https://example.com/1', pubDate: 'Mon, 01 Jan 2025 10:00:00 +0000', description: 'A test post' },
      { title: 'Second Post', link: 'https://example.com/2', pubDate: 'Sun, 31 Dec 2024 10:00:00 +0000', description: '' },
    ]);
    (global.fetch as jest.Mock).mockResolvedValue(new Response(rss, { status: 200 }));
    const result = await rssFeed.handler({ url: 'https://example.com/feed.rss' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Hello World');
    expect(result.content).toContain('Second Post');
    expect(result.content).toContain('https://example.com/1');
    expect(result.content).toContain('A test post');
  });

  it('includes feed hostname in header', async () => {
    const rss = makeRss([
      { title: 'Item', link: 'https://blog.example.com/1', pubDate: 'Mon, 01 Jan 2025 10:00:00 +0000', description: '' },
    ]);
    (global.fetch as jest.Mock).mockResolvedValue(new Response(rss, { status: 200 }));
    const result = await rssFeed.handler({ url: 'https://blog.example.com/feed.rss' });
    expect(result.content).toContain('blog.example.com');
  });

  it('respects maxItems limit', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `Post ${i + 1}`,
      link: `https://example.com/${i + 1}`,
      pubDate: `Mon, 0${(i % 9) + 1} Jan 2025 00:00:00 +0000`,
      description: '',
    }));
    const rss = makeRss(items);
    (global.fetch as jest.Mock).mockResolvedValue(new Response(rss, { status: 200 }));
    const result = await rssFeed.handler({ url: 'https://example.com/feed.rss', maxItems: 3 });
    expect(result.isError).toBeFalsy();
    const matches = result.content.match(/Post \d+/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(3);
  });

  it('sorts items newest-first', async () => {
    const rss = makeRss([
      { title: 'Older', link: 'https://example.com/1', pubDate: 'Mon, 01 Jan 2024 00:00:00 +0000', description: '' },
      { title: 'Newer', link: 'https://example.com/2', pubDate: 'Mon, 01 Jan 2025 00:00:00 +0000', description: '' },
    ]);
    (global.fetch as jest.Mock).mockResolvedValue(new Response(rss, { status: 200 }));
    const result = await rssFeed.handler({ url: 'https://example.com/feed.rss' });
    const newerPos = result.content.indexOf('Newer');
    const olderPos = result.content.indexOf('Older');
    expect(newerPos).toBeLessThan(olderPos);
  });

  it('appends unavailable note when summarize=true and no API key', async () => {
    const rss = makeRss([
      { title: 'Test', link: 'https://example.com/1', pubDate: 'Mon, 01 Jan 2025 10:00:00 +0000', description: '' },
    ]);
    (global.fetch as jest.Mock).mockResolvedValue(new Response(rss, { status: 200 }));
    const result = await rssFeed.handler({ url: 'https://example.com/feed.rss', summarize: 'true' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('AI summary unavailable');
  });

  it('includes AI summary when summarize=true and API key is set', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const rss = makeRss([
      { title: 'AI Post', link: 'https://example.com/1', pubDate: 'Mon, 01 Jan 2025 10:00:00 +0000', description: 'About AI' },
    ]);
    const openaiResponse = {
      choices: [{ message: { content: 'This feed covers AI topics.' } }],
    };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(rss, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(openaiResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await rssFeed.handler({ url: 'https://example.com/feed.rss', summarize: 'true' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('AI Summary');
    expect(result.content).toContain('This feed covers AI topics.');
  });

  it('shows unavailable note when OpenAI API call fails', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const rss = makeRss([
      { title: 'Post', link: 'https://example.com/1', pubDate: 'Mon, 01 Jan 2025 10:00:00 +0000', description: '' },
    ]);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(rss, { status: 200 }))
      .mockRejectedValueOnce(new Error('API error'));
    const result = await rssFeed.handler({ url: 'https://example.com/feed.rss', summarize: 'true' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('AI summary unavailable');
  });

  it('does not call OpenAI when summarize is not set', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const rss = makeRss([
      { title: 'Post', link: 'https://example.com/1', pubDate: 'Mon, 01 Jan 2025 10:00:00 +0000', description: '' },
    ]);
    (global.fetch as jest.Mock).mockResolvedValue(new Response(rss, { status: 200 }));
    const result = await rssFeed.handler({ url: 'https://example.com/feed.rss' });
    expect(result.isError).toBeFalsy();
    // fetch called exactly once (for the feed only, not for OpenAI)
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });
});
