import { type SkillDefinition } from '../skill';

/**
 * Web search skill using the DuckDuckGo Instant Answer API.
 * No API key required.
 */

interface DdgRelatedTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DdgRelatedTopic[];
}

interface DdgResponse {
  Abstract?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Answer?: string;
  Definition?: string;
  DefinitionSource?: string;
  RelatedTopics?: DdgRelatedTopic[];
  Results?: DdgRelatedTopic[];
}

export const webSearch: SkillDefinition = {
  name: 'webSearch',
  description:
    'Searches the web for up-to-date information using the DuckDuckGo Instant Answer API. ' +
    'No API key required.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (1–10). Defaults to 5.',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['query'],
  },
  category: 'web',
  riskLevel: 'low',
  handler: async (args) => {
    const query = String(args.query ?? '').trim();
    if (!query) return { content: 'Error: query is required', isError: true };
    const maxResults = typeof args.maxResults === 'number'
      ? Math.min(10, Math.max(1, Math.floor(args.maxResults)))
      : 5;

    const url =
      'https://api.duckduckgo.com/?' +
      new URLSearchParams({
        q: query,
        format: 'json',
        no_html: '1',
        skip_disambig: '1',
        no_redirect: '1',
      }).toString();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CopHarness/1.0 (webSearch skill)' },
      });
      clearTimeout(timer);
      if (!response.ok) {
        return { content: `Error: DuckDuckGo API returned ${response.status} ${response.statusText}`, isError: true };
      }
      const data = await response.json() as DdgResponse;
      const parts: string[] = [];

      if (data.Answer) {
        parts.push(`**Instant Answer:** ${data.Answer}`);
      }
      if (data.Abstract) {
        const source = data.AbstractSource ? ` (${data.AbstractSource})` : '';
        parts.push(`**Summary${source}:** ${data.Abstract}`);
        if (data.AbstractURL) {
          parts.push(`**Source:** ${data.AbstractURL}`);
        }
      }
      if (data.Definition) {
        const src = data.DefinitionSource ? ` (${data.DefinitionSource})` : '';
        parts.push(`**Definition${src}:** ${data.Definition}`);
      }

      // Prefer direct Results, fall back to RelatedTopics
      const directResults = (data.Results ?? []).filter((r) => r.Text && r.FirstURL).slice(0, maxResults);
      if (directResults.length > 0) {
        parts.push('\n**Results:**');
        for (const r of directResults) {
          parts.push(`- ${r.Text}\n  ${r.FirstURL}`);
        }
      } else {
        // Flatten nested RelatedTopics
        const allTopics: DdgRelatedTopic[] = [];
        for (const t of data.RelatedTopics ?? []) {
          if (t.Topics) {
            allTopics.push(...t.Topics);
          } else {
            allTopics.push(t);
          }
        }
        const relatedTopics = allTopics.filter((t) => t.Text && t.FirstURL).slice(0, maxResults);
        if (relatedTopics.length > 0) {
          parts.push('\n**Related Topics:**');
          for (const t of relatedTopics) {
            parts.push(`- ${t.Text}\n  ${t.FirstURL}`);
          }
        }
      }

      return { content: parts.join('\n') || 'No results found.' };
    } catch (err) {
      clearTimeout(timer);
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
