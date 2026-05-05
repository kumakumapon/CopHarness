import { type SkillDefinition } from '../skill';

/**
 * Deep research skill using the Tavily Search API with advanced search depth.
 * Performs multi-angle research by running a main query plus optional sub-queries,
 * deduplicates sources, and returns a comprehensive structured report.
 * Requires TAVILY_API_KEY environment variable.
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

/** Maximum character length for source content snippets in the report. */
const MAX_SNIPPET_LENGTH = 400;

/** Perform a single Tavily advanced search and return the parsed response. */
async function tavilyAdvancedSearch(
  apiKey: string,
  query: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<TavilyResponse> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      include_answer: true,
      search_depth: 'advanced',
    }),
  });
  if (!response.ok) {
    throw new Error(`Tavily API returned ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<TavilyResponse>;
}

export const deepResearch: SkillDefinition = {
  name: 'deepResearch',
  description:
    'Performs deep, multi-angle web research on a topic using the Tavily Search API with ' +
    'advanced search depth. Runs the main query plus optional sub-queries, deduplicates ' +
    'sources, and returns a comprehensive structured research report. ' +
    'More thorough than webSearch — best for complex questions that benefit from multiple ' +
    'perspectives or follow-up angles. ' +
    'Requires the TAVILY_API_KEY environment variable.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The main research topic or question.',
      },
      subQueries: {
        type: 'string',
        description:
          'Comma-separated list of additional sub-queries to explore different angles of the topic ' +
          '(e.g., "recent developments, criticism, future outlook"). Up to 3 sub-queries are used.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum results per query (1–10). Defaults to 5.',
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

    // Parse sub-queries (up to 3)
    const rawSubQueries = typeof args.subQueries === 'string' ? args.subQueries : '';
    const subQueries = rawSubQueries
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);

    const allQueries = [query, ...subQueries];
    const answers: string[] = [];
    const seenUrls = new Set<string>();
    const allSources: TavilyResult[] = [];

    // Run all queries with a 20-second timeout each
    for (const q of allQueries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const data = await tavilyAdvancedSearch(apiKey, q, maxResults, controller.signal);
        clearTimeout(timer);
        if (data.answer) {
          answers.push(`**${q}**\n${data.answer}`);
        }
        for (const result of data.results ?? []) {
          if (!seenUrls.has(result.url)) {
            seenUrls.add(result.url);
            allSources.push(result);
          }
        }
      } catch (err) {
        clearTimeout(timer);
        answers.push(`**${q}**\n(Search failed: ${err instanceof Error ? err.message : String(err)})`);
      }
    }

    if (answers.length === 0 && allSources.length === 0) {
      return { content: 'No results found.', isError: false };
    }

    const parts: string[] = [];
    parts.push(`# Deep Research: ${query}\n`);

    if (answers.length > 0) {
      parts.push('## Summaries\n');
      parts.push(answers.join('\n\n'));
    }

    if (allSources.length > 0) {
      parts.push('\n## Sources\n');
      // Sort by score descending (if available), then by insertion order
      const sorted = [...allSources].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      for (const [i, src] of sorted.entries()) {
        const snippet = src.content.length > MAX_SNIPPET_LENGTH
          ? (src.content.slice(0, MAX_SNIPPET_LENGTH).lastIndexOf(' ') > 0
              ? src.content.slice(0, src.content.slice(0, MAX_SNIPPET_LENGTH).lastIndexOf(' '))
              : src.content.slice(0, MAX_SNIPPET_LENGTH)) + '...'
          : src.content;
        parts.push(`${i + 1}. **${src.title}**\n   URL: ${src.url}\n   ${snippet}`);
      }
    }

    return { content: parts.join('\n') };
  },
};
