/**
 * Long-term memory as plain Markdown files, one directory per user scope.
 * Files are easy to inspect, edit and back up; no database is involved.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { resolveInside } from './files';
import { str, type Tool, type ToolContext } from './types';

const INDEX = 'MEMORY.md';

export function memoryDir(dataDir: string, scope: string): string {
  const safe = scope.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 120) || 'local';
  return path.join(dataDir, 'memory', safe);
}

function listMemoryFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const visit = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) visit(abs);
      else out.push(path.relative(dir, abs).split(path.sep).join('/'));
    }
  };
  visit(dir);
  return out.sort();
}

/** Text placed in the system prompt at session start. */
export function memorySummary(dataDir: string, scope: string): string | undefined {
  const dir = memoryDir(dataDir, scope);
  const files = listMemoryFiles(dir);
  if (!files.length) return undefined;
  let index = '';
  const indexPath = path.join(dir, INDEX);
  if (fs.existsSync(indexPath)) index = fs.readFileSync(indexPath, 'utf8').slice(0, 4000);
  return [
    `保存済みのメモ: ${files.join(', ')}`,
    index ? `\n${INDEX} の内容:\n${index}` : '',
  ].join('');
}

const resolveMemory = (ctx: ToolContext, p: string) => resolveInside(memoryDir(ctx.dataDir, ctx.scope), p);

export const memoryTool: Tool = {
  name: 'memory',
  description: [
    '会話をまたいで残す長期メモ（Markdown ファイル）を読み書きする。',
    'ユーザーの好み・継続中の作業・決定事項など、次回以降も役立つことだけを短く記録する。',
    `${INDEX} は索引として毎回の会話の冒頭で読み込まれる。command: view（path 省略で一覧）/ write / str_replace / delete。`,
  ].join(''),
  access: 'state',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', enum: ['view', 'write', 'str_replace', 'delete'] },
      path: { type: 'string', description: `例: "${INDEX}", "projects/foo.md"` },
      content: { type: 'string', description: 'write で書き込む内容' },
      old_str: { type: 'string' },
      new_str: { type: 'string' },
    },
    required: ['command'],
  },
  summarize: input => `${str(input.command)} ${str(input.path)}`.trim(),
  async run(input, ctx) {
    const command = str(input.command);
    const rel = str(input.path);
    const dir = memoryDir(ctx.dataDir, ctx.scope);
    if (command === 'view' && !rel) {
      const files = listMemoryFiles(dir);
      return { content: files.length ? files.join('\n') : 'メモはまだありません。' };
    }
    if (!rel) return { content: 'path を指定してください。', isError: true };
    const abs = resolveMemory(ctx, rel);
    switch (command) {
      case 'view': {
        const text = await fsp.readFile(abs, 'utf8').catch(() => undefined);
        return text === undefined ? { content: `メモがありません: ${rel}`, isError: true } : { content: text || '（空）' };
      }
      case 'write':
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, str(input.content), 'utf8');
        return { content: `保存しました: ${rel}` };
      case 'str_replace': {
        const text = await fsp.readFile(abs, 'utf8').catch(() => undefined);
        if (text === undefined) return { content: `メモがありません: ${rel}`, isError: true };
        const oldStr = str(input.old_str);
        if (!oldStr || !text.includes(oldStr)) return { content: 'old_str が見つかりません。', isError: true };
        await fsp.writeFile(abs, text.replace(oldStr, () => str(input.new_str)), 'utf8');
        return { content: `更新しました: ${rel}` };
      }
      case 'delete':
        await fsp.rm(abs, { force: true });
        return { content: `削除しました: ${rel}` };
      default:
        return { content: `不明なコマンドです: ${command}`, isError: true };
    }
  },
};
