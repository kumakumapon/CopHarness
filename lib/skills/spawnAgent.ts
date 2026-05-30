import type { SkillDefinition } from '../skill';
import { runAgentTask, BUILT_IN_ROLE_PROMPTS } from '../agents/orchestrator';

const builtInRoles = Object.keys(BUILT_IN_ROLE_PROMPTS).join(', ');

export const spawnAgent: SkillDefinition = {
  name: 'spawnAgent',
  description: `サブエージェントを生成して特定のタスクを実行します。組み込みロール: ${builtInRoles}。カスタムロール名と systemPrompt の指定も可能です。`,
  parameters: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        description: `エージェントのロール（${builtInRoles} または任意の役割名）`,
      },
      userPrompt: {
        type: 'string',
        description: 'エージェントへの指示・タスク内容',
      },
      systemPrompt: {
        type: 'string',
        description: '（オプション）カスタムシステムプロンプト。指定すると組み込みロールより優先されます。',
      },
    },
    required: ['role', 'userPrompt'],
  },
  category: 'system',
  riskLevel: 'high',
  handler: async (args) => {
    const role = String(args['role'] ?? 'assistant');
    const userPrompt = String(args['userPrompt'] ?? '');
    const customSystemPrompt = args['systemPrompt']
      ? String(args['systemPrompt'])
      : undefined;

    const result = await runAgentTask({
      role: customSystemPrompt
        ? { name: role, description: role, systemPrompt: customSystemPrompt }
        : role,
      userPrompt,
    });

    if (result.error) {
      return {
        content: `[${role}] エラー: ${result.error}`,
        isError: true,
      };
    }

    return { content: `[${role}] ${result.content}` };
  },
};
