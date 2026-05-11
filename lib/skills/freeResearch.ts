import { type SkillDefinition } from '../skill';

/**
 * API-key-free deep research skill.
 * Uses the DuckDuckGo Instant Answer API (free, no key) and the Wikipedia REST/Search APIs (free, no key)
 * to gather a structured research report without requiring any credentials.
 *
 * Sources used:
 *   - DuckDuckGo Instant Answer API: https://api.duckduckgo.com/
 *   - Wikipedia REST summary:        https://<lang>.wikipedia.org/api/rest_v1/page/summary/
 *   - Wikipedia full-text search:    https://<lang>.wikipedia.org/w/api.php
 */

/** Maximum characters kept from the Wikipedia extract. */
const MAX_WIKI_EXTRACT = 1_200;

/** Maximum characters kept from a DuckDuckGo related-topic text. */
const MAX_TOPIC_TEXT = 200;

/** Request timeout in milliseconds. */
const TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// DuckDuckGo Instant Answer API
// ---------------------------------------------------------------------------

interface DdgRelatedTopic {
  Text?: string;
  FirstURL?: string;
  /** Nested subtopics. */
  Topics?: DdgRelatedTopic[];
}

interface DdgResponse {
  Abstract?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Answer?: string;
  AnswerType?: string;
  Definition?: string;
  DefinitionSource?: string;
  RelatedTopics?: DdgRelatedTopic[];
  Results?: DdgRelatedTopic[];
  /** "D" = disambiguation, "A" = article, "C" = category, "" = nothing */
  Type?: string;
  Redirect?: string;
}

async function fetchDdg(query: string, signal: AbortSignal): Promise<DdgResponse> {
  const url =
    'https://api.duckduckgo.com/?' +
    new URLSearchParams({
      q: query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
      no_redirect: '1',
    }).toString();

  const response = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'CopHarness/1.0 (freeResearch skill)' },
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo API returned ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<DdgResponse>;
}

// ---------------------------------------------------------------------------
// Wikipedia APIs
// ---------------------------------------------------------------------------

interface WikiSearchResult {
  title: string;
  snippet: string;
  pageid: number;
}

interface WikiSummary {
  title: string;
  extract: string;
  content_urls?: { desktop?: { page?: string } };
}

/** Search Wikipedia for the query, return up to maxResults page titles. */
async function searchWikipedia(
  query: string,
  lang: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<WikiSearchResult[]> {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?` +
    new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      format: 'json',
      utf8: '1',
      srlimit: String(maxResults),
      srprop: 'snippet',
    }).toString();

  const response = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'CopHarness/1.0 (freeResearch skill)' },
  });
  if (!response.ok) {
    throw new Error(`Wikipedia search returned ${response.status}`);
  }
  const data = await response.json() as { query?: { search?: WikiSearchResult[] } };
  return data.query?.search ?? [];
}

/** Fetch a Wikipedia page summary by exact title. */
async function fetchWikiSummary(
  title: string,
  lang: string,
  signal: AbortSignal,
): Promise<WikiSummary | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const response = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'CopHarness/1.0 (freeResearch skill)' },
  });
  if (!response.ok) return null;
  return response.json() as Promise<WikiSummary>;
}

/** Strip basic HTML tags from a string and decode common HTML entities.
 * Uses a single-pass regex that removes both complete tags (<foo>) and
 * partial/unclosed tags (<script without a closing >) to prevent injection. */
function stripHtml(text: string): string {
  return text
    // Single pass: remove complete tags AND partial tags (closing '>' is optional)
    .replace(/<[^>]*>?/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const freeResearch: SkillDefinition = {
  name: 'freeResearch',
  description:
    'Performs deep research on a topic without requiring any API key. ' +
    'Queries the DuckDuckGo Instant Answer API for a quick summary and related topics, ' +
    'then searches Wikipedia for in-depth articles. ' +
    'Returns a structured research report. ' +
    'Use this for a language-specific research report (supports multiple Wikipedia language editions).',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The research topic or question.',
      },
      language: {
        type: 'string',
        description:
          'Wikipedia language code (e.g. "en" for English, "ja" for Japanese). Defaults to "en".',
        enum: ['en', 'ja', 'de', 'fr', 'es', 'zh', 'ko', 'pt', 'ru', 'it'],
      },
      maxWikiResults: {
        type: 'number',
        description: 'Maximum Wikipedia articles to include (1–5). Defaults to 3.',
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

    const lang =
      typeof args.language === 'string' &&
      /^[a-z]{2,3}$/.test(args.language)
        ? args.language
        : 'en';

    const maxWikiResults =
      typeof args.maxWikiResults === 'number'
        ? Math.min(5, Math.max(1, Math.floor(args.maxWikiResults)))
        : 3;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const { signal } = controller;

    const parts: string[] = [];
    parts.push(`# Free Research: ${query}\n`);

    try {
      // -----------------------------------------------------------------------
      // 1. DuckDuckGo Instant Answer
      // -----------------------------------------------------------------------
      let ddgData: DdgResponse | null = null;
      try {
        ddgData = await fetchDdg(query, signal);
      } catch {
        // Non-fatal — continue with Wikipedia
      }

      if (ddgData) {
        const ddgParts: string[] = [];

        if (ddgData.Answer) {
          ddgParts.push(`**Instant Answer:** ${ddgData.Answer}`);
        }
        if (ddgData.Abstract) {
          const source = ddgData.AbstractSource ? ` (${ddgData.AbstractSource})` : '';
          ddgParts.push(`**Summary${source}:** ${ddgData.Abstract}`);
          if (ddgData.AbstractURL) {
            ddgParts.push(`**Source URL:** ${ddgData.AbstractURL}`);
          }
        }
        if (ddgData.Definition) {
          const src = ddgData.DefinitionSource ? ` (${ddgData.DefinitionSource})` : '';
          ddgParts.push(`**Definition${src}:** ${ddgData.Definition}`);
        }

        // Flatten related topics (may have nested Topics arrays)
        const allTopics: DdgRelatedTopic[] = [];
        for (const t of ddgData.RelatedTopics ?? []) {
          if (t.Topics) {
            allTopics.push(...t.Topics);
          } else {
            allTopics.push(t);
          }
        }

        const topicsWithText = allTopics
          .filter((t) => t.Text && t.FirstURL)
          .slice(0, 6);

        if (topicsWithText.length > 0) {
          ddgParts.push('\n**Related Topics:**');
          for (const t of topicsWithText) {
            const text = stripHtml(t.Text!).slice(0, MAX_TOPIC_TEXT);
            ddgParts.push(`- ${text}\n  ${t.FirstURL}`);
          }
        }

        const topResults = (ddgData.Results ?? []).filter((r) => r.Text && r.FirstURL).slice(0, 3);
        if (topResults.length > 0) {
          ddgParts.push('\n**Top Results:**');
          for (const r of topResults) {
            const text = stripHtml(r.Text!).slice(0, MAX_TOPIC_TEXT);
            ddgParts.push(`- ${text}\n  ${r.FirstURL}`);
          }
        }

        if (ddgParts.length > 0) {
          parts.push('## DuckDuckGo\n');
          parts.push(ddgParts.join('\n'));
        }
      }

      // -----------------------------------------------------------------------
      // 2. Wikipedia
      // -----------------------------------------------------------------------
      let wikiResults: WikiSearchResult[] = [];
      try {
        wikiResults = (await searchWikipedia(query, lang, maxWikiResults, signal)).slice(0, maxWikiResults);
      } catch {
        // Non-fatal
      }

      if (wikiResults.length > 0) {
        parts.push('\n## Wikipedia\n');
        for (const result of wikiResults) {
          try {
            const summary = await fetchWikiSummary(result.title, lang, signal);
            if (summary) {
              const boundary = summary.extract.slice(0, MAX_WIKI_EXTRACT).lastIndexOf(' ');
              const extract = summary.extract.length > MAX_WIKI_EXTRACT
                ? (boundary > 0 ? summary.extract.slice(0, boundary) : summary.extract.slice(0, MAX_WIKI_EXTRACT)) + '...'
                : summary.extract;
              const pageUrl = summary.content_urls?.desktop?.page
                ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(result.title)}`;
              parts.push(`### ${summary.title}\n${extract}\n**URL:** ${pageUrl}\n`);
            }
          } catch {
            // Skip pages that fail to load
          }
        }
      }

    } finally {
      clearTimeout(timer);
    }

    if (parts.length <= 1) {
      return { content: `No information found for: "${query}"` };
    }

    return { content: parts.join('\n') };
  },
};
