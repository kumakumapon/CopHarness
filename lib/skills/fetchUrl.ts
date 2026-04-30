import { type SkillDefinition } from '../skill';

/** Very simple HTML → plain-text conversion (no external dependencies). */
function htmlToText(html: string): string {
  // Remove <script> and <style> blocks entirely
  let text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert common block/inline elements to spacing
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\n## ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
    .replace(/<\/th>/gi, '\t')
    .replace(/<hr\s*\/?>/gi, '\n---\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

  // Collapse excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

const MAX_RESPONSE_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export const fetchUrl: SkillDefinition = {
  name: 'fetchUrl',
  description:
    'Fetches the content of a URL and returns it as plain text (HTML is converted to text). ' +
    'Returns up to 20 000 characters.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (http:// or https:// only).',
      },
    },
    required: ['url'],
  },
  category: 'web',
  riskLevel: 'medium',
  handler: async (args) => {
    const url = String(args.url ?? '').trim();
    if (!url) return { content: 'Error: url is required', isError: true };
    if (!/^https?:\/\//i.test(url)) {
      return { content: 'Error: only http:// and https:// URLs are supported', isError: true };
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'CopHarness/1.0 (+https://github.com)' },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        return { content: `Error: HTTP ${response.status} ${response.statusText}`, isError: true };
      }
      const contentType = response.headers.get('content-type') ?? '';
      const rawText = await response.text();
      let result: string;
      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        result = htmlToText(rawText);
      } else {
        result = rawText;
      }
      if (result.length > MAX_RESPONSE_CHARS) {
        result = result.slice(0, MAX_RESPONSE_CHARS) + '\n[truncated]';
      }
      return { content: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error fetching URL: ${msg}`, isError: true };
    }
  },
};
