import { type SkillDefinition } from '../skill';
import { promptTemplates, getTemplateById } from '../promptTemplates';

export const listPromptTemplates: SkillDefinition = {
  name: 'listPromptTemplates',
  description:
    'プロンプトテンプレートの一覧を返します。各テンプレートのID・日本語名・説明・必要なフィールド情報（ID・日本語名・必須かどうか・ヒント）が含まれます。buildPromptFromTemplate を呼ぶ前にこのスキルで利用可能なテンプレートとフィールドを確認してください。',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (_args) => {
    const list = promptTemplates.map((t) => ({
      id: t.id,
      nameJa: t.nameJa,
      descriptionJa: t.descriptionJa,
      category: t.category,
      icon: t.icon,
      fields: t.fields.map((f) => ({
        id: f.id,
        labelJa: f.labelJa,
        required: f.required,
        hint: f.hint,
        placeholder: f.placeholder,
        options: f.options,
      })),
    }));
    return { content: JSON.stringify(list, null, 2) };
  },
};

export const buildPromptFromTemplate: SkillDefinition = {
  name: 'buildPromptFromTemplate',
  description:
    'テンプレートIDとフィールド値（JSON文字列）を受け取り、完成したプロンプトを返します。先に listPromptTemplates でテンプレート一覧と各フィールドの要件を確認し、ユーザーから必要な情報を収集してからこのスキルを呼んでください。',
  parameters: {
    type: 'object',
    properties: {
      templateId: {
        type: 'string',
        description:
          'プロンプトテンプレートのID。listPromptTemplates で確認できます（例: "code-generation"）。',
      },
      valuesJson: {
        type: 'string',
        description:
          'フィールドIDをキー、ユーザー入力値をバリューとするJSONオブジェクト文字列。例: {"language":"TypeScript","task":"HTTPサーバーを実装する"}',
      },
    },
    required: ['templateId', 'valuesJson'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const templateId = args.templateId as string;
    const valuesJson = args.valuesJson as string;

    const template = getTemplateById(templateId);
    if (!template) {
      return {
        content: `テンプレートID "${templateId}" が見つかりません。listPromptTemplates で有効なIDを確認してください。`,
        isError: true,
      };
    }

    let values: Record<string, string>;
    try {
      values = JSON.parse(valuesJson);
    } catch {
      return {
        content:
          'valuesJson のJSONパースに失敗しました。有効なJSONオブジェクト文字列を指定してください。',
        isError: true,
      };
    }

    const missingRequired = template.fields
      .filter((f) => f.required && !values[f.id])
      .map((f) => `"${f.id}" (${f.labelJa})`);

    if (missingRequired.length > 0) {
      return {
        content: `必須フィールドが不足しています: ${missingRequired.join(', ')}`,
        isError: true,
      };
    }

    const prompt = template.buildPrompt(values);
    return { content: prompt };
  },
};
