/**
 * Agent Skills: folders containing a SKILL.md (YAML-style front matter with
 * `name` and `description`, then instructions) plus any supporting files.
 * Only names and descriptions go into the system prompt; the model loads a
 * skill's full instructions with the `skill` tool when it needs them.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveInside } from './tools/files';
import { str, type Tool } from './tools/types';

export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
  body: string;
}

export function parseSkillFile(text: string): { meta: Record<string, string>; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: match[2] };
}

export function skillDirs(projectRoot: string, dataDir: string): string[] {
  return [path.join(projectRoot, 'skills'), path.join(dataDir, 'skills')];
}

export function discoverSkills(dirs: string[]): SkillInfo[] {
  const found = new Map<string, SkillInfo>();
  for (const root of dirs) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, entry.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const { meta, body } = parseSkillFile(fs.readFileSync(file, 'utf8'));
      const name = meta.name || entry.name;
      if (found.has(name)) continue;
      found.set(name, { name, description: meta.description || '(説明なし)', dir: path.join(root, entry.name), body });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function createSkillTool(skills: SkillInfo[]): Tool {
  return {
    name: 'skill',
    description: 'システムプロンプトに列挙されたスキルの手順書（SKILL.md）や付属ファイルを読み込む。該当するスキルがある作業では最初に読む。',
    access: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: skills.map(s => s.name) },
        file: { type: 'string', description: 'スキル内の付属ファイル（省略時は SKILL.md）' },
      },
      required: ['name'],
    },
    summarize: input => str(input.name) + (input.file ? `/${str(input.file)}` : ''),
    async run(input) {
      const skill = skills.find(s => s.name === input.name);
      if (!skill) return { content: `スキルが見つかりません: ${str(input.name)}`, isError: true };
      if (input.file) {
        const abs = resolveInside(skill.dir, str(input.file));
        if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return { content: `ファイルがありません: ${str(input.file)}`, isError: true };
        return { content: fs.readFileSync(abs, 'utf8') };
      }
      const files = fs.readdirSync(skill.dir).filter(f => f !== 'SKILL.md');
      return { content: `${skill.body.trim()}${files.length ? `\n\n付属ファイル: ${files.join(', ')}（file 引数で読める）` : ''}` };
    },
  };
}
