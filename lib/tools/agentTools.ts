import type { TodoItem } from '../types';
import { str, type Tool } from './types';

const STATUSES = ['pending', 'in_progress', 'completed'];

export const todoTool: Tool = {
  name: 'todo_write',
  description: '複数手順の作業では最初に作業リストを作り、進捗に合わせて更新する。毎回リスト全体を渡す。進行中は同時に1件まで。',
  access: 'state',
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: STATUSES },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  summarize: input => `${Array.isArray(input.todos) ? input.todos.length : 0} 件`,
  async run(input, ctx) {
    const todos = (input.todos as TodoItem[]).map(t => ({ content: String(t.content), status: t.status }));
    ctx.setTodos(todos);
    const done = todos.filter(t => t.status === 'completed').length;
    return { content: `作業リストを更新しました（完了 ${done}/${todos.length}）。` };
  },
};

export const taskTool: Tool = {
  name: 'task',
  description: [
    '独立した調査や作業をサブエージェントに任せる。サブエージェントは新しいコンテキストで同じツールを使い、最終結果だけを返す。',
    '広い範囲の探索や、本筋の文脈を汚したくない作業に使う。prompt には必要な背景と期待する出力を全て書く。',
  ].join(''),
  access: 'read', // the sub-agent's own tool calls are permission-checked individually
  inputSchema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: '3〜8語程度の作業名' },
      prompt: { type: 'string', description: 'サブエージェントへの指示（自己完結した内容）' },
    },
    required: ['description', 'prompt'],
  },
  summarize: input => str(input.description),
  async run(input, ctx) {
    if (!ctx.runSubagent) return { content: 'サブエージェントからさらにサブエージェントは起動できません。', isError: true };
    const result = await ctx.runSubagent(str(input.description), str(input.prompt));
    return { content: result || '（サブエージェントは結果を返しませんでした）' };
  },
};
