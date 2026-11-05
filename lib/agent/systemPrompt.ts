import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SkillInfo } from '../skills';
import { memorySummary } from '../tools/memory';

const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'COPHARNESS.md'];

export interface SystemPromptOptions {
  workspace: string;
  dataDir: string;
  scope: string;
  toolNames: string[];
  skills: SkillInfo[];
  extra?: string;
  /** e.g. "discord" — replies are shown in a chat app. */
  channel?: string;
  subagent?: boolean;
  now?: Date;
}

function readInstructions(workspace: string): string | undefined {
  for (const name of INSTRUCTION_FILES) {
    const file = path.join(workspace, name);
    if (fs.existsSync(file)) return `${name}:\n${fs.readFileSync(file, 'utf8').slice(0, 20_000)}`;
  }
  return undefined;
}

/**
 * Built once when a session starts and then kept unchanged, so provider
 * prompt caches stay valid. Day-level date only — no clock time.
 */
export function buildSystemPrompt(o: SystemPromptOptions): string {
  const date = (o.now ?? new Date()).toISOString().slice(0, 10);
  const has = (name: string) => o.toolNames.includes(name);
  const sections: string[] = [];

  sections.push(o.subagent
    ? 'あなたは親エージェントから作業を任されたサブエージェントです。与えられた作業だけを行い、最後に結果を簡潔にまとめて返してください。ユーザーとは直接対話できません。'
    : 'あなたは CopHarness 上で動くAIアシスタントです。ツールを使って調査・作業を行い、ユーザーの目的を達成します。ユーザーの言語で応答してください。');

  const guidance = [
    '- 推測で答えず、必要ならツールで確認してから答える。',
    has('todo_write') ? '- 3手順以上の作業は todo_write で計画し、進捗に合わせて更新する。' : '',
    has('task') ? '- 広い調査や独立した作業は task でサブエージェントに任せられる。' : '',
    '- 権限が拒否されたツールは同じ形で再試行せず、理由を踏まえて別の方法を取るかユーザーに相談する。',
    '- 削除・外部への送信など取り消しにくい操作は、目的を明確にしてから行う。',
    '- 作業が終わったら、何をしたか・結果・残課題を短く報告する。',
  ].filter(Boolean);
  sections.push(`# 進め方\n${guidance.join('\n')}`);

  sections.push([
    '# 環境',
    `- 日付: ${date}`,
    `- ワークスペース: ${o.workspace}（ファイル操作と bash はここで行う）`,
    `- OS: ${os.platform()} ${os.arch()}`,
  ].join('\n'));

  if (o.channel) {
    sections.push(`# 返信先\nこの会話はチャットアプリ（${o.channel}）経由です。短めの段落で答え、長い表や大きなコードブロックは避けてください。`);
  }

  if (o.skills.length && has('skill')) {
    sections.push(`# スキル\n該当する作業では、まず skill ツールで手順書を読んでください。\n${o.skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`);
  }

  if (has('memory') && !o.subagent) {
    const memory = memorySummary(o.dataDir, o.scope);
    sections.push(`# 長期メモ\nmemory ツールで会話をまたぐメモを読み書きできます。${memory ? `\n${memory}` : '（まだメモはありません）'}`);
  }

  const instructions = readInstructions(o.workspace);
  if (instructions) sections.push(`# プロジェクトの指示\n${instructions}`);
  if (o.extra?.trim()) sections.push(`# 追加の指示\n${o.extra.trim()}`);
  return sections.join('\n\n');
}
