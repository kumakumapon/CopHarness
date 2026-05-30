import { type SkillDefinition } from '../skill';

export const textStats: SkillDefinition = {
  name: 'textStats',
  description:
    'Analyzes text and returns statistics: character count, word count, line count, ' +
    'sentence count, and average word length.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to analyze.',
      },
    },
    required: ['text'],
  },
  category: 'utility',
  riskLevel: 'low',
  handler: async (args) => {
    const text = String(args.text ?? '');
    const chars = text.length;
    const charsNoSpaces = text.replace(/\s/g, '').length;
    const lines = text === '' ? 0 : text.split('\n').length;
    const wordTokens = text.trim() === '' ? [] : text.trim().split(/\s+/);
    const wordCount = wordTokens.length === 1 && wordTokens[0] === '' ? 0 : wordTokens.length;
    const sentences = text.trim() === '' ? 0 : (text.match(/[.!?]/g) ?? []).length;
    const avgWordLen =
      wordCount === 0
        ? 0
        : +(wordTokens.reduce((s, w) => s + w.length, 0) / wordCount).toFixed(2);

    const output = [
      `Characters (with spaces): ${chars}`,
      `Characters (without spaces): ${charsNoSpaces}`,
      `Words: ${wordCount}`,
      `Lines: ${lines}`,
      `Sentences: ${sentences}`,
      `Average word length: ${avgWordLen}`,
    ];
    return { content: output.join('\n') };
  },
};
