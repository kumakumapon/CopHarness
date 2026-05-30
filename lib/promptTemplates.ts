export type TemplateFieldType = 'text' | 'textarea' | 'select';

export interface TemplateField {
  id: string;
  labelJa: string;
  type: TemplateFieldType;
  required: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  hint?: string;
}

export type TemplateValues = Record<string, string>;

export interface PromptTemplate {
  id: string;
  nameJa: string;
  descriptionJa: string;
  category: string;
  icon: string;
  fields: TemplateField[];
  buildPrompt: (values: TemplateValues) => string;
}

export const promptTemplates: PromptTemplate[] = [
  {
    id: 'code-generation',
    nameJa: 'コード生成',
    descriptionJa: '要件を伝えてコードを自動生成します',
    category: '開発',
    icon: '💻',
    fields: [
      {
        id: 'language',
        labelJa: 'プログラミング言語',
        type: 'text',
        required: true,
        placeholder: 'TypeScript, Python, Rust など',
        hint: '使用する言語名',
      },
      {
        id: 'task',
        labelJa: 'やりたいこと・要件',
        type: 'textarea',
        required: true,
        hint: 'コードで実現したい処理の説明',
      },
      {
        id: 'constraints',
        labelJa: '制約・条件',
        type: 'textarea',
        required: false,
        hint: 'パフォーマンス要件、ライブラリ制限など（任意）',
      },
    ],
    buildPrompt: (v) => {
      let p = `以下の要件に基づいて ${v.language} のコードを書いてください。\n\n## 要件\n${v.task}`;
      if (v.constraints) p += `\n\n## 制約・条件\n${v.constraints}`;
      p += '\n\nコードにはわかりやすいコメントを付けてください。';
      return p;
    },
  },
  {
    id: 'text-correction',
    nameJa: '文章校正',
    descriptionJa: '文章の誤りや不自然な表現を修正します',
    category: '文章',
    icon: '✍️',
    fields: [
      {
        id: 'text',
        labelJa: '校正したい文章',
        type: 'textarea',
        required: true,
        hint: '修正してほしい文章をそのまま入力',
      },
      {
        id: 'purpose',
        labelJa: '用途・文体',
        type: 'text',
        required: false,
        hint: 'ビジネスメール、ブログ記事、論文など（任意）',
      },
    ],
    buildPrompt: (v) => {
      let p = `以下の文章を校正してください。誤字・脱字、文法の誤り、不自然な表現を修正してください。\n\n## 文章\n${v.text}`;
      if (v.purpose) p += `\n\n## 用途\n${v.purpose}`;
      p += '\n\n修正後の文章と、主な修正箇所の説明を返してください。';
      return p;
    },
  },
  {
    id: 'translation',
    nameJa: '翻訳',
    descriptionJa: 'テキストを指定した言語に翻訳します',
    category: '文章',
    icon: '🌐',
    fields: [
      {
        id: 'text',
        labelJa: '翻訳したいテキスト',
        type: 'textarea',
        required: true,
      },
      {
        id: 'targetLang',
        labelJa: '翻訳先の言語',
        type: 'text',
        required: true,
        placeholder: '英語、中国語、フランス語 など',
      },
      {
        id: 'tone',
        labelJa: '文体・トーン',
        type: 'text',
        required: false,
        placeholder: 'フォーマル、カジュアル、ビジネス など',
        hint: '文体の指定（任意）',
      },
    ],
    buildPrompt: (v) => {
      let p = `以下のテキストを${v.targetLang}に翻訳してください。\n\n## テキスト\n${v.text}`;
      if (v.tone) p += `\n\n## 文体\n${v.tone}`;
      p += '\n\n翻訳結果のみを返してください。';
      return p;
    },
  },
  {
    id: 'summarization',
    nameJa: '要約',
    descriptionJa: '長いテキストや記事を簡潔にまとめます',
    category: '文章',
    icon: '📝',
    fields: [
      {
        id: 'text',
        labelJa: '要約したいテキスト',
        type: 'textarea',
        required: true,
      },
      {
        id: 'format',
        labelJa: '要約の形式',
        type: 'text',
        required: true,
        placeholder: '3文で, 箇条書きで, 200字以内で など',
      },
      {
        id: 'focus',
        labelJa: '重点を置く観点',
        type: 'text',
        required: false,
        hint: '特に重要な観点があれば（任意）',
      },
    ],
    buildPrompt: (v) => {
      let p = `以下のテキストを${v.format}要約してください。\n\n## テキスト\n${v.text}`;
      if (v.focus) p += `\n\n## 重点を置く観点\n${v.focus}`;
      return p;
    },
  },
  {
    id: 'email',
    nameJa: 'ビジネスメール作成',
    descriptionJa: 'ビジネスシーン向けのメールを生成します',
    category: 'コミュニケーション',
    icon: '📧',
    fields: [
      {
        id: 'purpose',
        labelJa: 'メールの目的',
        type: 'text',
        required: true,
        placeholder: '会議の依頼、謝罪、問い合わせ など',
      },
      {
        id: 'recipient',
        labelJa: '宛先・関係性',
        type: 'text',
        required: true,
        placeholder: '取引先の部長、社内の同僚 など',
      },
      {
        id: 'keyPoints',
        labelJa: '伝えたい要点',
        type: 'textarea',
        required: true,
      },
      {
        id: 'tone',
        labelJa: '文体',
        type: 'text',
        required: false,
        placeholder: '丁寧、フレンドリー など',
        hint: '文体の指定（任意、デフォルトは丁寧）',
      },
    ],
    buildPrompt: (v) => {
      let p = `以下の条件でビジネスメールを作成してください。\n\n## メールの目的\n${v.purpose}\n\n## 宛先・関係性\n${v.recipient}\n\n## 伝えたい要点\n${v.keyPoints}`;
      if (v.tone) p += `\n\n## 文体\n${v.tone}`;
      p += '\n\n件名と本文を含むメール全文を返してください。';
      return p;
    },
  },
  {
    id: 'brainstorming',
    nameJa: 'ブレインストーミング',
    descriptionJa: 'テーマに対してアイデアを幅広く提案します',
    category: '創造',
    icon: '💡',
    fields: [
      {
        id: 'topic',
        labelJa: 'テーマ・課題',
        type: 'text',
        required: true,
      },
      {
        id: 'count',
        labelJa: 'アイデアの数',
        type: 'text',
        required: true,
        placeholder: '5, 10, 20 など',
      },
      {
        id: 'constraints',
        labelJa: '制約・条件',
        type: 'text',
        required: false,
        hint: '予算制限、対象ユーザーなど（任意）',
      },
    ],
    buildPrompt: (v) => {
      let p = `「${v.topic}」について${v.count}個のアイデアをブレインストーミングしてください。`;
      if (v.constraints) p += `\n\n## 制約・条件\n${v.constraints}`;
      p += '\n\n各アイデアに短い説明を添えてください。実用的なものから斬新なものまで幅広く提案してください。';
      return p;
    },
  },
  {
    id: 'qa-document',
    nameJa: 'ドキュメントQ&A',
    descriptionJa: '資料の内容をもとに質問に答えます',
    category: '分析',
    icon: '🔍',
    fields: [
      {
        id: 'document',
        labelJa: '参照ドキュメント',
        type: 'textarea',
        required: true,
        hint: '質問の根拠にしてほしいテキスト',
      },
      {
        id: 'question',
        labelJa: '質問',
        type: 'text',
        required: true,
      },
    ],
    buildPrompt: (v) => {
      return `以下のドキュメントを参照して、質問に回答してください。ドキュメントに記載のない内容はその旨を明示してください。\n\n## ドキュメント\n${v.document}\n\n## 質問\n${v.question}`;
    },
  },
  {
    id: 'persona-roleplay',
    nameJa: 'ペルソナ設定',
    descriptionJa: 'LLM に特定の専門家・役割を演じさせます',
    category: '応用',
    icon: '🎭',
    fields: [
      {
        id: 'persona',
        labelJa: '役割・ペルソナ',
        type: 'text',
        required: true,
        placeholder: 'シニアエンジニア、マーケターなど',
      },
      {
        id: 'expertise',
        labelJa: '専門分野',
        type: 'text',
        required: false,
        hint: '特定の専門知識（任意）',
      },
      {
        id: 'task',
        labelJa: '対応してほしいこと',
        type: 'textarea',
        required: true,
      },
    ],
    buildPrompt: (v) => {
      let p = `あなたは${v.persona}です。`;
      if (v.expertise) p += `特に${v.expertise}に精通しています。`;
      p += `\n\n以下の依頼に、${v.persona}として回答してください。\n\n## 依頼\n${v.task}`;
      return p;
    },
  },
];

export function getTemplateById(id: string): PromptTemplate | undefined {
  return promptTemplates.find((t) => t.id === id);
}

export function buildWizardSystemPrompt(template: PromptTemplate): string {
  const fieldLines = template.fields
    .map(
      (f) =>
        `- フィールドID: "${f.id}" | 日本語名: 「${f.labelJa}」 | 必須: ${
          f.required ? 'はい' : 'いいえ'
        }${f.hint ? ` | ヒント: ${f.hint}` : ''}`,
    )
    .join('\n');

  const exampleJson =
    '{' + template.fields.map((f) => `"${f.id}": "（収集した値）"`).join(', ') + '}';

  return `あなたは「プロンプト作成アシスタント」です。
ユーザーが「${template.nameJa}」のプロンプトを完成させるために必要な情報を、自然な会話形式で収集してください。

## 収集が必要なフィールド
${fieldLines}

## 進め方のルール
1. 日本語で話しかけてください
2. 一度に一つの質問だけしてください
3. 必須フィールドから順に質問してください
4. 任意フィールドは「〇〇はありますか？なければスキップできます」と聞いてください
5. ユーザーの回答から情報を自然に抽出してください
6. すべての必須フィールドが揃い、任意フィールドの確認も済んだら以下の形式で応答してください

## 情報収集完了時の応答形式
以下のJSONブロックを出力し、その後「プロンプトを生成しました！」と続けてください。
任意フィールドがスキップされた場合は空文字列にしてください。

<COLLECTED>
${exampleJson}
</COLLECTED>

プロンプトを生成しました！`;
}
