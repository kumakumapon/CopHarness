import { type SkillDefinition } from '../skill';

/**
 * Web search skill using the Tavily Search API.
 * Requires TAVILY_API_KEY environment variable.
 * Sign up for a free key at https://tavily.com
 */

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

interface TavilyResponse {
  results?: TavilyResult[];
  answer?: string;
}

export const webSearch: SkillDefinition = {
  name: 'webSearch',
  description:
    'Searches the web for up-to-date information using the Tavily Search API. ' +
    'Requires the TAVILY_API_KEY environment variable.',
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
  riskLevel: 'medium',
  requiresEnv: ['TAVILY_API_KEY'],
  handler: async (args) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return { content: 'Error: TAVILY_API_KEY environment variable is not set.', isError: true };
    }
    const query = String(args.query ?? '').trim();
    if (!query) return { content: 'Error: query is required', isError: true };
    const maxResults = typeof args.maxResults === 'number'
      ? Math.min(10, Math.max(1, Math.floor(args.maxResults)))
      : 5;

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          include_answer: true,
          search_depth: 'basic',
        }),
      });
      if (!response.ok) {
        return { content: `Error: Tavily API returned ${response.status} ${response.statusText}`, isError: true };
      }
      const data = await response.json() as TavilyResponse;
      const parts: string[] = [];
      if (data.answer) {
        parts.push(`**Summary:** ${data.answer}\n`);
      }
      if (data.results && data.results.length > 0) {
        parts.push('**Results:**');
        for (const r of data.results) {
          parts.push(`\n- **${r.title}**\n  URL: ${r.url}\n  ${r.content}`);
        }
      }
      return { content: parts.join('\n') || 'No results found.' };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
