/**
 * proposeSkill — system skill that allows the agent to propose a new
 * reusable generated skill when it notices a recurring task.
 *
 * The agent provides:
 *   - name: unique camelCase skill name
 *   - description: what the skill does
 *   - problem: the recurring problem it solves
 *   - code: CommonJS module code (module.exports = async (args) => SkillResult)
 *   - riskLevel: low | medium | high
 *   - testPlanJson: JSON array of { description?, args, expect? } test cases
 *
 * The handler creates a SkillProposal and immediately runs the test phase.
 * If all tests pass the proposal enters awaiting_approval status.
 * If any test fails the details are returned so the agent can fix the code.
 * The skill never auto-registers — a human must approve via the dashboard.
 */

import { type SkillDefinition } from '../skill';
import { createSkillProposal } from '../skillProposals/store';
import { runProposalTestPhase } from '../skillProposals/lifecycle';
import { getSkillExecutionContext } from './executionContext';

export const proposeSkill: SkillDefinition = {
  name: 'proposeSkill',
  description:
    'エージェントが繰り返し発生するタスクに気付いたとき、再利用可能な生成スキルを提案するために使います。' +
    ' コードは `module.exports = async (args) => ({ content: "..." })` の形式で記述してください。' +
    ' テストケースは必須です。テストが通ると承認待ち（awaiting_approval）になります。' +
    ' スキルは人間の承認後にのみ登録されます。',
  category: 'system',
  riskLevel: 'medium',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'スキル名（英字始まり、英数字とアンダースコアのみ、3〜64文字）',
      },
      description: {
        type: 'string',
        description: 'スキルの説明',
      },
      problem: {
        type: 'string',
        description: 'このスキルが解決する繰り返し発生する課題',
      },
      code: {
        type: 'string',
        description: 'CommonJS形式のスキルコード。module.exports = async (args) => SkillResult | string',
      },
      riskLevel: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'スキルのリスクレベル（low/medium/high）',
      },
      testPlanJson: {
        type: 'string',
        description:
          'テストケースのJSON配列。各要素: { description?: string, args: object, expect?: { contains?: string, equals?: string, isError?: boolean } }',
      },
    },
    required: ['name', 'description', 'problem', 'code', 'riskLevel', 'testPlanJson'],
  },
  handler: async (args) => {
    const name = String(args.name ?? '').trim();
    const description = String(args.description ?? '').trim();
    const problem = String(args.problem ?? '').trim();
    const code = String(args.code ?? '').trim();
    const riskLevelRaw = String(args.riskLevel ?? '').trim();
    const testPlanJsonRaw = String(args.testPlanJson ?? '').trim();

    // Validate riskLevel
    if (!['low', 'medium', 'high'].includes(riskLevelRaw)) {
      return {
        content: `エラー: riskLevel は "low", "medium", "high" のいずれかを指定してください。受け取った値: "${riskLevelRaw}"`,
        isError: true,
      };
    }
    const riskLevel = riskLevelRaw as 'low' | 'medium' | 'high';

    // Parse testPlanJson
    let testPlan: unknown;
    try {
      testPlan = JSON.parse(testPlanJsonRaw);
    } catch {
      return {
        content: 'エラー: testPlanJson のJSONパースに失敗しました。有効なJSON配列を指定してください。',
        isError: true,
      };
    }

    if (!Array.isArray(testPlan)) {
      return {
        content: 'エラー: testPlanJson は配列である必要があります。',
        isError: true,
      };
    }

    if (testPlan.length === 0) {
      return {
        content: 'エラー: testPlanJson には少なくとも1件のテストケースが必要です。',
        isError: true,
      };
    }

    // Get execution context for personId/channelKey/taskId
    const context = getSkillExecutionContext();

    // Create the proposal
    let proposal;
    try {
      proposal = await createSkillProposal({
        name,
        description,
        problem,
        proposedCode: code,
        riskLevel,
        testPlan: testPlan as Array<{
          description?: string;
          args: Record<string, unknown>;
          expect?: { contains?: string; equals?: string; isError?: boolean };
        }>,
        personId: context?.personId,
        channelKey: context?.channelKey,
        taskId: context?.taskId,
      });
    } catch (err) {
      return {
        content: `エラー: プロポーザルの作成に失敗しました。${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    // Immediately run the test phase
    let tested;
    try {
      tested = await runProposalTestPhase(proposal.id);
    } catch (err) {
      return {
        content: `エラー: テストフェーズの実行に失敗しました。${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    if (tested.status === 'awaiting_approval') {
      const passCount = tested.testResults?.filter((r) => r.passed).length ?? 0;
      const totalCount = tested.testResults?.length ?? 0;
      return {
        content:
          `スキル "${name}" のプロポーザルが承認待ちになりました。\n` +
          `テスト結果: ${passCount} / ${totalCount} 件通過\n` +
          `プロポーザルID: ${tested.id}\n` +
          `ダッシュボードから承認してください。`,
      };
    } else {
      // tests_failed
      const failedResults = tested.testResults?.filter((r) => !r.passed) ?? [];
      const details = failedResults
        .map((r) => `  テスト[${r.index}]: ${r.detail ?? '失敗'}`)
        .join('\n');
      return {
        content:
          `スキル "${name}" のテストが失敗しました。コードを修正して再提案してください。\n` +
          `プロポーザルID: ${tested.id}\n` +
          `失敗したテスト:\n${details}`,
        isError: true,
      };
    }
  },
};
