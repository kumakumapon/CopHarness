import { type SkillDefinition } from '../skill';

/**
 * arXiv paper search skill using the arXiv Atom API (free, no API key required).
 * Inspired by the arxiv skill in karaage0703/ai-assistant-workspace.
 */

interface ArXivEntry {
  title: string;
  id: string;
  published: string;
  summary: string;
  authors: string[];
  categories: string[];
}

/** Parse a minimal Atom XML feed from arXiv into structured entries. */
function parseAtom(xml: string): ArXivEntry[] {
  const entries: ArXivEntry[] = [];
  const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
  for (const match of entryMatches) {
    const block = match[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1]?.replace(/\s+/g, ' ').trim() ?? '';
    const idRaw = (block.match(/<id>([\s\S]*?)<\/id>/) ?? [])[1]?.trim() ?? '';
    // arXiv IDs look like: http://arxiv.org/abs/2401.12345v1
    const id = idRaw.replace(/^.*\/abs\//, '').replace(/v\d+$/, '');
    const published = (block.match(/<published>([\s\S]*?)<\/published>/) ?? [])[1]?.trim().slice(0, 10) ?? '';
    const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/) ?? [])[1]?.replace(/\s+/g, ' ').trim() ?? '';
    const authorMatches = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)];
    const authors = authorMatches.map((m) => m[1].trim());
    const categoryMatches = [...block.matchAll(/<category[^>]*term="([^"]+)"/g)];
    const categories = categoryMatches.map((m) => m[1]);
    entries.push({ title, id, published, summary, authors, categories });
  }
  return entries;
}

export const arXivSearch: SkillDefinition = {
  name: 'arXivSearch',
  description:
    'Searches arXiv for academic papers using the arXiv Atom API (free, no API key required). ' +
    'Returns paper titles, authors, abstracts, and arXiv IDs. ' +
    'Useful for finding the latest AI/ML research, physics, mathematics, and computer science papers.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Search query. Supports arXiv search syntax (e.g., "all:LLM agent", "ti:transformer", "au:Vaswani"). ' +
          'For category filter add e.g., "cat:cs.AI".',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of papers to return (1–10). Defaults to 5.',
        minimum: 1,
        maximum: 10,
      },
      sortBy: {
        type: 'string',
        description: 'Sort order: "relevance" (default), "lastUpdatedDate", or "submittedDate".',
        enum: ['relevance', 'lastUpdatedDate', 'submittedDate'],
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
    const sortBy = ['relevance', 'lastUpdatedDate', 'submittedDate'].includes(String(args.sortBy ?? ''))
      ? String(args.sortBy)
      : 'relevance';

    const url =
      `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}` +
      `&start=0&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=descending`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        return { content: `Error: arXiv API returned ${response.status} ${response.statusText}`, isError: true };
      }
      const xml = await response.text();
      const entries = parseAtom(xml);
      if (entries.length === 0) {
        return { content: `No papers found for query: "${query}"` };
      }
      const lines = entries.map((e, i) => {
        const authorsStr = e.authors.slice(0, 3).join(', ') + (e.authors.length > 3 ? ' et al.' : '');
        const abstract = e.summary.length > 300 ? e.summary.slice(0, 300) + '...' : e.summary;
        return [
          `${i + 1}. **${e.title}**`,
          `   Authors: ${authorsStr}`,
          `   Published: ${e.published}`,
          `   arXiv ID: ${e.id}  →  https://arxiv.org/abs/${e.id}`,
          `   Categories: ${e.categories.join(', ')}`,
          `   Abstract: ${abstract}`,
        ].join('\n');
      });
      return { content: `Found ${entries.length} paper(s) for "${query}":\n\n${lines.join('\n\n')}` };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
