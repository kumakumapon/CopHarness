import { type SkillDefinition } from '../skill';

/**
 * Text translation skill using the DeepL API.
 * Requires DEEPL_API_KEY environment variable.
 * Free tier available at https://www.deepl.com/pro-api
 */

interface DeepLResponse {
  translations?: Array<{ detected_source_language: string; text: string }>;
}

const SUPPORTED_LANGUAGES = [
  'BG', 'CS', 'DA', 'DE', 'EL', 'EN', 'EN-GB', 'EN-US',
  'ES', 'ET', 'FI', 'FR', 'HU', 'ID', 'IT', 'JA', 'KO',
  'LT', 'LV', 'NB', 'NL', 'PL', 'PT', 'PT-BR', 'PT-PT',
  'RO', 'RU', 'SK', 'SL', 'SV', 'TR', 'UK', 'ZH',
];

export const translateText: SkillDefinition = {
  name: 'translateText',
  description:
    'Translates text using the DeepL API. ' +
    'Requires the DEEPL_API_KEY environment variable. ' +
    `Supported target languages: ${SUPPORTED_LANGUAGES.join(', ')}.`,
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to translate.',
      },
      targetLanguage: {
        type: 'string',
        description: `Target language code, e.g. "JA", "EN-US", "ZH". Supported: ${SUPPORTED_LANGUAGES.join(', ')}.`,
      },
      sourceLanguage: {
        type: 'string',
        description: 'Optional source language code. If omitted, DeepL auto-detects it.',
      },
    },
    required: ['text', 'targetLanguage'],
  },
  category: 'external',
  riskLevel: 'low',
  requiresEnv: ['DEEPL_API_KEY'],
  handler: async (args) => {
    const apiKey = process.env.DEEPL_API_KEY;
    if (!apiKey) {
      return { content: 'Error: DEEPL_API_KEY environment variable is not set.', isError: true };
    }
    const text = String(args.text ?? '').trim();
    if (!text) return { content: 'Error: text is required', isError: true };
    const targetLanguage = String(args.targetLanguage ?? '').trim().toUpperCase();
    if (!SUPPORTED_LANGUAGES.includes(targetLanguage)) {
      return {
        content: `Error: unsupported target language "${targetLanguage}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
        isError: true,
      };
    }

    // DeepL free-tier uses api-free.deepl.com; paid uses api.deepl.com
    const baseUrl = apiKey.endsWith(':fx')
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';

    const body: Record<string, string | string[]> = {
      text: [text],
      target_lang: targetLanguage,
    };
    if (args.sourceLanguage) {
      body.source_lang = String(args.sourceLanguage).trim().toUpperCase();
    }

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `DeepL-Auth-Key ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return { content: `Error: DeepL API returned ${response.status} ${response.statusText}`, isError: true };
      }
      const data = await response.json() as DeepLResponse;
      const translation = data.translations?.[0];
      if (!translation) return { content: 'Error: no translation returned', isError: true };
      const detected = translation.detected_source_language
        ? ` (detected source: ${translation.detected_source_language})`
        : '';
      return { content: `${translation.text}${detected}` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
