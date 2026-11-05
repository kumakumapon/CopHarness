import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { str, truncateMiddle, type Tool, type ToolContext } from './types';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.venv', '__pycache__']);
const MAX_READ_LINES = 2000;
const MAX_LINE_CHARS = 2000;

export class PathError extends Error {}

/** Resolve a model-supplied path inside the workspace; symlinks may not lead outside it. */
export function resolveInside(root: string, requested: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, requested || '.');
  const rel = path.relative(base, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new PathError(`パス "${requested}" はワークスペースの外です（${base}）`);
  }
  // Canonicalize the nearest existing ancestor so a symlink cannot escape.
  let probe = target;
  while (!fs.existsSync(probe) && probe !== base) probe = path.dirname(probe);
  if (fs.existsSync(probe) && fs.existsSync(base)) {
    const realBase = fs.realpathSync(base);
    const realProbe = fs.realpathSync(probe);
    const realRel = path.relative(realBase, realProbe);
    if (realRel === '..' || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) {
      throw new PathError(`パス "${requested}" はシンボリックリンク経由でワークスペースの外を指しています`);
    }
  }
  return target;
}

const display = (ctx: ToolContext, abs: string) => path.relative(ctx.workspace, abs) || '.';

/** Convert a glob (`**`, `*`, `?`, `{a,b}`) to a RegExp matched against a relative POSIX path. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end > i) {
        re += `(?:${glob.slice(i + 1, end).split(',').map(s => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
        i = end;
      } else re += '\\{';
    } else re += /[.+^$()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}$`);
}

async function* walk(dir: string, root: string): AsyncGenerator<string> {
  let entries: fs.Dirent[];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(abs, root);
    } else if (entry.isFile()) {
      yield path.relative(root, abs).split(path.sep).join('/');
    }
  }
}

function isBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8000);
  return sample.includes(0);
}

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'ワークスペース内のテキストファイルを行番号付きで読む。大きなファイルは offset / limit で範囲指定する。',
  access: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'ワークスペースからの相対パス' },
      offset: { type: 'integer', description: '読み始める行（1始まり）', minimum: 1 },
      limit: { type: 'integer', description: '読む行数（既定 2000）', minimum: 1 },
    },
    required: ['path'],
  },
  subject: input => str(input.path),
  summarize: input => str(input.path),
  async run(input, ctx) {
    const abs = resolveInside(ctx.workspace, str(input.path));
    const stat = await fsp.stat(abs).catch(() => undefined);
    if (!stat) return { content: `ファイルがありません: ${display(ctx, abs)}`, isError: true };
    if (stat.isDirectory()) return { content: `${display(ctx, abs)} はディレクトリです。list_files を使ってください。`, isError: true };
    const buf = await fsp.readFile(abs);
    if (isBinary(buf)) return { content: `${display(ctx, abs)} はバイナリファイルです（${stat.size} bytes）。`, isError: true };
    const lines = buf.toString('utf8').split('\n');
    const start = Math.max(1, Number(input.offset) || 1);
    const limit = Math.min(Number(input.limit) || MAX_READ_LINES, MAX_READ_LINES);
    const slice = lines.slice(start - 1, start - 1 + limit);
    const width = String(start + slice.length).length;
    const body = slice.map((line, i) => {
      const text = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
      return `${String(start + i).padStart(width)}\t${text}`;
    }).join('\n');
    const more = start - 1 + slice.length < lines.length ? `\n\n（全 ${lines.length} 行。続きは offset=${start + slice.length}）` : '';
    return { content: (body || '（空のファイル）') + more };
  },
};

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'ワークスペース内にファイルを作成または上書きする。既存ファイルの部分変更には edit_file を使う。',
  access: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'ワークスペースからの相対パス' },
      content: { type: 'string', description: 'ファイルの内容全体' },
    },
    required: ['path', 'content'],
  },
  subject: input => str(input.path),
  summarize: input => `${str(input.path)}（${str(input.content).length} 文字）`,
  async run(input, ctx) {
    const abs = resolveInside(ctx.workspace, str(input.path));
    const existed = fs.existsSync(abs);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, str(input.content), 'utf8');
    return { content: `${existed ? '上書き' : '作成'}しました: ${display(ctx, abs)}` };
  },
};

export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'ファイル内の文字列 old_string を new_string に置き換える。old_string はファイル内で一意である必要がある（replace_all で全置換）。',
  access: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string', description: '置き換える既存の文字列（前後の行を含めて一意にする）' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  subject: input => str(input.path),
  summarize: input => str(input.path),
  async run(input, ctx) {
    const abs = resolveInside(ctx.workspace, str(input.path));
    const original = await fsp.readFile(abs, 'utf8').catch(() => undefined);
    if (original === undefined) return { content: `ファイルがありません: ${display(ctx, abs)}`, isError: true };
    const oldStr = str(input.old_string);
    if (!oldStr) return { content: 'old_string が空です。新規作成には write_file を使ってください。', isError: true };
    const count = original.split(oldStr).length - 1;
    if (count === 0) return { content: 'old_string が見つかりません。read_file で現在の内容を確認してください。', isError: true };
    if (count > 1 && !input.replace_all) return { content: `old_string が ${count} 箇所にあります。前後の文脈を含めて一意にするか replace_all を指定してください。`, isError: true };
    const updated = input.replace_all ? original.split(oldStr).join(str(input.new_string)) : original.replace(oldStr, () => str(input.new_string));
    await fsp.writeFile(abs, updated, 'utf8');
    return { content: `${display(ctx, abs)} を更新しました（${input.replace_all ? count : 1} 箇所）` };
  },
};

export const listFilesTool: Tool = {
  name: 'list_files',
  description: 'ワークスペース内のファイルを glob パターン（例: "**/*.ts", "docs/*"）で一覧する。node_modules と .git は除外。',
  access: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'glob パターン（既定 "**/*"）' },
      path: { type: 'string', description: '検索を始めるディレクトリ（既定はワークスペース直下）' },
    },
  },
  summarize: input => str(input.pattern, '**/*') + (input.path ? ` in ${str(input.path)}` : ''),
  async run(input, ctx) {
    const dir = resolveInside(ctx.workspace, str(input.path, '.'));
    if (!fs.existsSync(dir)) return { content: `ディレクトリがありません: ${display(ctx, dir)}`, isError: true };
    const re = globToRegExp(str(input.pattern, '**/*'));
    const found: string[] = [];
    let total = 0;
    for await (const rel of walk(dir, dir)) {
      if (!re.test(rel)) continue;
      total++;
      if (found.length < 500) found.push(rel);
    }
    if (!total) return { content: '一致するファイルはありません。' };
    const prefix = path.relative(ctx.workspace, dir);
    const lines = found.map(f => (prefix ? `${prefix.split(path.sep).join('/')}/${f}` : f));
    return { content: lines.join('\n') + (total > found.length ? `\n…ほか ${total - found.length} 件` : '') };
  },
};

export const grepTool: Tool = {
  name: 'grep',
  description: 'ワークスペース内のファイル内容を正規表現で検索し "パス:行番号: 行" を返す。',
  access: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'JavaScript 正規表現' },
      path: { type: 'string', description: '検索するディレクトリまたはファイル' },
      glob: { type: 'string', description: '対象ファイルの glob（例: "**/*.md"）' },
      ignore_case: { type: 'boolean' },
    },
    required: ['pattern'],
  },
  summarize: input => `/${str(input.pattern)}/` + (input.glob ? ` ${str(input.glob)}` : ''),
  async run(input, ctx) {
    let re: RegExp;
    try { re = new RegExp(str(input.pattern), input.ignore_case ? 'i' : ''); } catch (err) {
      return { content: `正規表現が不正です: ${(err as Error).message}`, isError: true };
    }
    const start = resolveInside(ctx.workspace, str(input.path, '.'));
    const stat = await fsp.stat(start).catch(() => undefined);
    if (!stat) return { content: `パスがありません: ${display(ctx, start)}`, isError: true };
    const fileRe = input.glob ? globToRegExp(str(input.glob)) : undefined;
    const files: string[] = [];
    if (stat.isFile()) files.push(start);
    else for await (const rel of walk(start, start)) if (!fileRe || fileRe.test(rel)) files.push(path.join(start, rel));
    const matches: string[] = [];
    for (const file of files) {
      if (ctx.signal.aborted || matches.length >= 200) break;
      const buf = await fsp.readFile(file).catch(() => undefined);
      if (!buf || buf.length > 2_000_000 || isBinary(buf)) continue;
      buf.toString('utf8').split('\n').forEach((line, i) => {
        if (matches.length < 200 && re.test(line)) matches.push(`${display(ctx, file)}:${i + 1}: ${line.slice(0, 300)}`);
      });
    }
    if (!matches.length) return { content: '一致する行はありません。' };
    return { content: truncateMiddle(matches.join('\n'), 40_000) + (matches.length >= 200 ? '\n（200 件で打ち切り）' : '') };
  },
};
