import * as fs from 'node:fs';
import * as path from 'node:path';
import { bashTool, childEnv } from '../lib/tools/bash';
import { editFileTool, globToRegExp, grepTool, listFilesTool, readFileTool, resolveInside, writeFileTool } from '../lib/tools/files';
import { memorySummary, memoryTool } from '../lib/tools/memory';
import { validateInput, type ToolContext } from '../lib/tools/types';
import { webFetchTool } from '../lib/tools/web';
import { createSkillTool, discoverSkills, parseSkillFile } from '../lib/skills';
import { tempDir } from './helpers';

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  const root = tempDir();
  const workspace = path.join(root, 'ws');
  fs.mkdirSync(workspace);
  return {
    sessionId: 's', workspace, dataDir: path.join(root, 'data'), scope: 'local',
    signal: new AbortController().signal, emit: () => {}, setTodos: () => {}, ...overrides,
  };
}

describe('workspace confinement', () => {
  it('rejects paths outside the workspace', () => {
    const c = ctx();
    expect(() => resolveInside(c.workspace, '../secret')).toThrow(/外/);
    expect(() => resolveInside(c.workspace, '/etc/passwd')).toThrow(/外/);
    expect(resolveInside(c.workspace, 'a/b.txt')).toBe(path.join(c.workspace, 'a/b.txt'));
  });

  it('rejects symlinks that lead outside', () => {
    const c = ctx();
    const outside = tempDir();
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
    fs.symlinkSync(outside, path.join(c.workspace, 'link'));
    expect(() => resolveInside(c.workspace, 'link/secret.txt')).toThrow(/シンボリックリンク/);
  });
});

describe('file tools', () => {
  it('writes, reads with line numbers, and edits uniquely', async () => {
    const c = ctx();
    await writeFileTool.run({ path: 'dir/a.txt', content: 'one\ntwo\ntwo\n' }, c);
    const read = await readFileTool.run({ path: 'dir/a.txt' }, c);
    expect(read.content).toMatch(/1\tone/);
    const ambiguous = await editFileTool.run({ path: 'dir/a.txt', old_string: 'two', new_string: '2' }, c);
    expect(ambiguous.isError).toBe(true);
    const all = await editFileTool.run({ path: 'dir/a.txt', old_string: 'two', new_string: '2', replace_all: true }, c);
    expect(all.isError).toBeFalsy();
    expect(fs.readFileSync(path.join(c.workspace, 'dir/a.txt'), 'utf8')).toBe('one\n2\n2\n');
    expect((await editFileTool.run({ path: 'dir/a.txt', old_string: 'zzz', new_string: '' }, c)).isError).toBe(true);
  });

  it('pages long files', async () => {
    const c = ctx();
    fs.writeFileSync(path.join(c.workspace, 'long.txt'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'));
    const r = await readFileTool.run({ path: 'long.txt', offset: 10, limit: 5 }, c);
    expect(r.content).toContain('line 10');
    expect(r.content).toContain('line 14');
    expect(r.content).not.toContain('line 15\n');
    expect(r.content).toContain('offset=15');
  });

  it('lists files by glob and skips node_modules', async () => {
    const c = ctx();
    for (const f of ['src/a.ts', 'src/b.js', 'src/deep/c.ts', 'node_modules/x/d.ts', 'README.md']) {
      fs.mkdirSync(path.dirname(path.join(c.workspace, f)), { recursive: true });
      fs.writeFileSync(path.join(c.workspace, f), 'x');
    }
    const r = await listFilesTool.run({ pattern: '**/*.ts' }, c);
    expect(r.content.split('\n').sort()).toEqual(['src/a.ts', 'src/deep/c.ts']);
    expect(globToRegExp('*.{md,txt}').test('README.md')).toBe(true);
  });

  it('greps file contents', async () => {
    const c = ctx();
    fs.writeFileSync(path.join(c.workspace, 'a.md'), 'hello\nTODO: fix\n');
    fs.writeFileSync(path.join(c.workspace, 'b.txt'), 'todo later');
    const r = await grepTool.run({ pattern: 'todo', ignore_case: true, glob: '*.md' }, c);
    expect(r.content).toBe('a.md:2: TODO: fix');
    expect((await grepTool.run({ pattern: '(' }, c)).isError).toBe(true);
  });
});

describe('bash', () => {
  it('runs in the workspace and reports the exit code', async () => {
    const c = ctx();
    const r = await bashTool.run({ command: 'pwd && exit 3' }, c);
    expect(r.content).toContain('[exit 3]');
    expect(r.content).toContain(fs.realpathSync(c.workspace));
    expect(r.isError).toBe(true);
  });

  it('does not pass credentials to commands', async () => {
    expect(childEnv({ PATH: '/bin', OPENAI_API_KEY: 'x', DISCORD_BOT_TOKEN: 'y', COPHARNESS_API_KEY: 'z', HOME: '/h' } as unknown as NodeJS.ProcessEnv)).toEqual({ PATH: '/bin', HOME: '/h' });
  });

  it('stops on timeout', async () => {
    const r = await bashTool.run({ command: 'sleep 5', timeout_ms: 1000 }, ctx());
    expect(r.content).toContain('タイムアウト');
  });
});

describe('web_fetch', () => {
  it('refuses private network targets', async () => {
    const r = await webFetchTool.run({ url: 'http://127.0.0.1:1/' }, ctx());
    expect(r.isError).toBe(true);
    expect(r.content).toContain('拒否');
  });
});

describe('memory', () => {
  it('keeps notes per scope and summarizes them for the system prompt', async () => {
    const alice = ctx({ scope: 'discord:alice' });
    const bob = { ...alice, scope: 'discord:bob' };
    await memoryTool.run({ command: 'write', path: 'MEMORY.md', content: 'likes tea' }, alice);
    expect((await memoryTool.run({ command: 'view', path: 'MEMORY.md' }, alice)).content).toBe('likes tea');
    expect((await memoryTool.run({ command: 'view', path: 'MEMORY.md' }, bob)).isError).toBe(true);
    await memoryTool.run({ command: 'str_replace', path: 'MEMORY.md', old_str: 'tea', new_str: 'coffee' }, alice);
    expect(memorySummary(alice.dataDir, 'discord:alice')).toContain('likes coffee');
    expect(memorySummary(alice.dataDir, 'discord:bob')).toBeUndefined();
    await expect(memoryTool.run({ command: 'view', path: '../discord_bob/MEMORY.md' }, alice)).rejects.toThrow(/外/);
  });
});

describe('Agent Skills', () => {
  it('discovers SKILL.md folders and serves their files', async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'report'));
    fs.writeFileSync(path.join(root, 'report', 'SKILL.md'), '---\nname: weekly-report\ndescription: 週報を書く\n---\n# 手順\n1. 集計する');
    fs.writeFileSync(path.join(root, 'report', 'template.md'), 'TEMPLATE');
    const skills = discoverSkills([root, path.join(root, 'missing')]);
    expect(skills).toEqual([expect.objectContaining({ name: 'weekly-report', description: '週報を書く' })]);
    const tool = createSkillTool(skills);
    expect((await tool.run({ name: 'weekly-report' }, ctx())).content).toContain('付属ファイル: template.md');
    expect((await tool.run({ name: 'weekly-report', file: 'template.md' }, ctx())).content).toBe('TEMPLATE');
    await expect(tool.run({ name: 'weekly-report', file: '../../etc/passwd' }, ctx())).rejects.toThrow();
    expect(parseSkillFile('no front matter').meta).toEqual({});
  });
});

describe('validateInput', () => {
  it('checks types, required fields, enums and nested items', () => {
    const schema = {
      type: 'object',
      properties: {
        n: { type: 'integer', minimum: 1 },
        mode: { type: 'string', enum: ['a', 'b'] },
        list: { type: 'array', items: { type: 'object', properties: { s: { type: 'string' } }, required: ['s'] } },
      },
      required: ['n'],
    };
    expect(validateInput(schema, { n: 2, mode: 'a', list: [{ s: 'x' }] })).toEqual([]);
    expect(validateInput(schema, {})).toHaveLength(1);
    expect(validateInput(schema, { n: 0.5, mode: 'c', list: [{}] })).toHaveLength(3);
  });
});
