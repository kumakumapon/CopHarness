import { type SkillDefinition } from '../skill';
import { createAdapter, resolveProvider } from '../adapterFactory';

/**
 * Text translation skill using the configured LLM.
 * No external translation API key required — uses the same LLM provider
 * that is already configured for the application.
 */

export const translateText: SkillDefinition = {
  name: 'translateText',
  description:
    'Translates text using the configured LLM. No external API key required — ' +
    'uses the same LLM provider configured for this application. ' +
    'Supports any language pair the underlying model understands.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to translate.',
      },
      targetLanguage: {
        type: 'string',
        description: 'Target language name or code, e.g. "Japanese", "English", "ZH", "FR".',
      },
      sourceLanguage: {
        type: 'string',
        description: 'Optional source language name or code. If omitted, the LLM auto-detects it.',
      },
    },
    required: ['text', 'targetLanguage'],
  },
  category: 'external',
  riskLevel: 'low',
  handler: async (args) => {
    const text = String(args.text ?? '').trim();
    if (!text) return { content: 'Error: text is required', isError: true };
    const targetLanguage = String(args.targetLanguage ?? '').trim();
    if (!targetLanguage) return { content: 'Error: targetLanguage is required', isError: true };

    const sourceHint = args.sourceLanguage
      ? ` from ${String(args.sourceLanguage).trim()}`
      : '';
    const prompt =
      `Translate the following text${sourceHint} to ${targetLanguage}. ` +
      `Return only the translated text, with no explanation or extra commentary.\n\n${text}`;

    try {
      const provider = resolveProvider();
      const localProviders = ['lmstudio', 'lemonade'];
      const apiKey = localProviders.includes(provider)
        ? undefined
        : process.env.COPILOT_PROVIDER_API_KEY ||
          process.env.COPILOT_API_KEY ||
          process.env.GITHUB_COPILOT_API_KEY ||
          process.env.OPENAI_API_KEY ||
          process.env.ANTHROPIC_API_KEY ||
          process.env.GEMINI_API_KEY;
      const model =
        process.env.COPILOT_MODEL ||
        process.env.OPENAI_MODEL ||
        process.env.ANTHROPIC_MODEL ||
        process.env.GEMINI_MODEL ||
        process.env.LMSTUDIO_MODEL ||
        process.env.LEMONADE_MODEL ||
        'gpt-5-mini';
      const timeoutMs = Number(process.env.COPILOT_TIMEOUT_MS) || 60_000;

      const adapter = createAdapter({ provider, model, apiKey, timeoutMs });
      const response = await adapter.complete({
        messages: [{ role: 'user', content: prompt }],
        timeoutMs,
      });
      return { content: response.content };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
