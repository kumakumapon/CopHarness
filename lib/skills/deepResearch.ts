import { type SkillDefinition } from '../skill';

/**
 * Deep research skill using the DuckDuckGo Instant Answer API and Wikipedia.
 * Performs multi-angle research by running a main query plus optional sub-queries,
 * deduplicates Wikipedia articles by title, and returns a comprehensive structured report.
 * No API key required.
 *
 * Sources used:
 *   - DuckDuckGo Instant Answer API: https://api.duckduckgo.com/
 *   - Wikipedia REST summary:        https://en.wikipedia.org/api/rest_v1/page/summary/
 *   - Wikipedia full-text search:    https://en.wikipedia.org/w/api.php
 */

/** Maximum characters kept from a Wikipedia extract snippet. */
const MAX_SNIPPET_LENGTH = 400;

/** Request timeout per query in milliseconds. */
const TIMEOUT_MS = 20_000;

interface DdgResponse {
  Abstract?: string;
  Answer?: string;
  Definition?: string;
}

interface WikiSearchResult {
  title: string;
  snippet: string;
}

interface WikiSummary {
  title: string;
  extract: string;
  content_urls?: { desktop?: { page?: string } };
}

export const deepResearch: SkillDefinition = {
  name: 'deepResearch',
  description:
    'Performs deep, multi-angle web research on a topic using the DuckDuckGo Instant Answer API ' +
    'and Wikipedia. Runs the main query plus optional sub-queries, deduplicates sources, ' +
    'and returns a comprehensive structured research report. ' +
    'More thorough than webSearch — best for complex questions that benefit from multiple ' +
    'perspectives or follow-up angles. No API key required.',
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
        description: 'Maximum Wikipedia articles per query (1–5). Defaults to 3.',
        minimum: 1,
        maximum: 5,
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
      ? Math.min(5, Math.max(1, Math.floor(args.maxResults)))
      : 3;

    // Parse sub-queries (up to 3)
    const rawSubQueries = typeof args.subQueries === 'string' ? args.subQueries : '';
    const subQueries = rawSubQueries
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);

    const allQueries = [query, ...subQueries];
    const summaries: string[] = [];
    const seenTitles = new Set<string>();
    const allSources: { title: string; extract: string; url: string }[] = [];

    for (const q of allQueries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const { signal } = controller;

      try {
        // DuckDuckGo Instant Answer
        try {
          const ddgUrl =
            'https://api.duckduckgo.com/?' +
            new URLSearchParams({
              q,
              format: 'json',
              no_html: '1',
              skip_disambig: '1',
              no_redirect: '1',
            }).toString();
          const ddgResponse = await fetch(ddgUrl, {
            signal,
            headers: { 'User-Agent': 'CopHarness/1.0 (deepResearch skill)' },
          });
          if (ddgResponse.ok) {
            const ddgData = await ddgResponse.json() as DdgResponse;
            const ddgSummary = ddgData.Answer ?? ddgData.Abstract ?? ddgData.Definition ?? '';
            if (ddgSummary) {
              summaries.push(`**${q}**\n${ddgSummary}`);
            }
          }
        } catch {
          // Non-fatal — continue with Wikipedia
        }

        // Wikipedia search
        try {
          const wikiSearchUrl =
            'https://en.wikipedia.org/w/api.php?' +
            new URLSearchParams({
              action: 'query',
              list: 'search',
              srsearch: q,
              format: 'json',
              utf8: '1',
              srlimit: String(maxResults),
              srprop: 'snippet',
            }).toString();
          const wikiSearchResponse = await fetch(wikiSearchUrl, {
            signal,
            headers: { 'User-Agent': 'CopHarness/1.0 (deepResearch skill)' },
          });
          if (wikiSearchResponse.ok) {
            const wikiData = await wikiSearchResponse.json() as { query?: { search?: WikiSearchResult[] } };
            const results = (wikiData.query?.search ?? []).slice(0, maxResults);
            for (const result of results) {
              if (seenTitles.has(result.title)) continue;
              seenTitles.add(result.title);
              try {
                const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(result.title)}`;
                const summaryResponse = await fetch(summaryUrl, {
                  signal,
                  headers: { 'User-Agent': 'CopHarness/1.0 (deepResearch skill)' },
                });
                if (summaryResponse.ok) {
                  const summary = await summaryResponse.json() as WikiSummary;
                  const boundary = summary.extract.slice(0, MAX_SNIPPET_LENGTH).lastIndexOf(' ');
                  const extract =
                    summary.extract.length > MAX_SNIPPET_LENGTH
                      ? (boundary > 0
                          ? summary.extract.slice(0, boundary)
                          : summary.extract.slice(0, MAX_SNIPPET_LENGTH)) + '...'
                      : summary.extract;
                  const pageUrl =
                    summary.content_urls?.desktop?.page ??
                    `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title)}`;
                  allSources.push({ title: summary.title, extract, url: pageUrl });
                }
              } catch {
                // Skip pages that fail to load
              }
            }
          }
        } catch {
          // Non-fatal
        }
      } finally {
        clearTimeout(timer);
      }
    }

    if (summaries.length === 0 && allSources.length === 0) {
      return { content: 'No results found.', isError: false };
    }

    const parts: string[] = [];
    parts.push(`# Deep Research: ${query}\n`);

    if (summaries.length > 0) {
      parts.push('## Summaries\n');
      parts.push(summaries.join('\n\n'));
    }

    if (allSources.length > 0) {
      parts.push('\n## Sources\n');
      for (const [i, src] of allSources.entries()) {
        parts.push(`${i + 1}. **${src.title}**\n   URL: ${src.url}\n   ${src.extract}`);
      }
    }

    return { content: parts.join('\n') };
  },
};
