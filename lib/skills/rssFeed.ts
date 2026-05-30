import { type SkillDefinition } from '../skill';
import { parseRss, type RssItem } from './techNews';

/**
 * RSS feed reader skill.
 * Fetches any RSS 2.0 / Atom feed URL, parses the items, and optionally
 * generates a concise LLM summary of the entries using the OpenAI-compatible
 * API (requires OPENAI_API_KEY or BYOK_API_KEY environment variable).
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SUMMARY_CHARS = 4_000;

/** Fetch and parse an RSS/Atom feed from the given URL. */
async function fetchRssFeed(url: string, sourceName: string): Promise<RssItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CopHarness/1.0 (RSS reader)' },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return parseRss(text, sourceName);
}

/**
 * Call the OpenAI chat completions API to summarize feed items.
 * Returns the summary string, or null if the API call fails.
 */
async function generateSummary(
  feedTitle: string,
  items: RssItem[],
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.BYOK_API_KEY;
  if (!apiKey) return null;

  const baseURL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  // Build a compact plaintext digest to send to the LLM
  const digest = items
    .map((item, i) => {
      const parts = [`${i + 1}. ${item.title}`];
      if (item.description) parts.push(`   ${item.description}`);
      return parts.join('\n');
    })
    .join('\n')
    .slice(0, MAX_SUMMARY_CHARS);

  const systemPrompt =
    'You are a helpful assistant. Summarize the following RSS feed items concisely in ' +
    '3-5 sentences. Highlight the most important updates and identify recurring keywords ' +
    'or themes. Reply in the same language as the feed titles.';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Feed: ${feedTitle}\n\n${digest}` },
          ],
          max_tokens: 512,
          temperature: 0.3,
        }),
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

export const rssFeed: SkillDefinition = {
  name: 'rssFeed',
  description:
    'Fetches any RSS 2.0 or Atom feed URL and returns the latest items with titles, ' +
    'links, descriptions, and publication dates sorted newest-first. ' +
    'Optionally generates an AI summary of the items when summarize=true and ' +
    'OPENAI_API_KEY (or BYOK_API_KEY) is set. ' +
    'Useful for monitoring website updates and, combined with scheduling, for ' +
    'periodic update notifications.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The RSS or Atom feed URL (http:// or https:// only).',
      },
      maxItems: {
        type: 'number',
        description: 'Maximum number of feed items to return (1–20). Defaults to 5.',
        minimum: 1,
        maximum: 20,
      },
      summarize: {
        type: 'string',
        description:
          'Set to "true" to generate an AI summary of the feed items. ' +
          'Requires OPENAI_API_KEY or BYOK_API_KEY to be set. Defaults to "false".',
      },
    },
    required: ['url'],
  },
  category: 'web',
  riskLevel: 'low',
  handler: async (args) => {
    const url = String(args.url ?? '').trim();
    if (!url) {
      return { content: 'Error: url is required', isError: true };
    }
    if (!/^https?:\/\//i.test(url)) {
      return { content: 'Error: only http:// and https:// URLs are supported', isError: true };
    }

    const maxItems =
      typeof args.maxItems === 'number'
        ? Math.min(20, Math.max(1, Math.floor(args.maxItems)))
        : 5;

    const summarize =
      args.summarize === true ||
      String(args.summarize ?? '').toLowerCase() === 'true';

    // Derive a display name from the URL hostname
    let sourceName: string;
    try {
      sourceName = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      sourceName = url;
    }

    let items: RssItem[];
    try {
      items = await fetchRssFeed(url, sourceName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error fetching feed: ${msg}`, isError: true };
    }

    if (items.length === 0) {
      return {
        content: `No items found in the feed at ${url}. The feed may be empty or in an unsupported format.`,
      };
    }

    // Sort newest-first
    items.sort((a, b) => {
      const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      if (isNaN(ta) && isNaN(tb)) return 0;
      if (isNaN(ta)) return 1;
      if (isNaN(tb)) return -1;
      return tb - ta;
    });

    const topItems = items.slice(0, maxItems);

    // Format feed items
    const lines = topItems.map((item, i) => {
      const displayDate = item.pubDate ? ` (${item.pubDate.slice(0, 16)})` : '';
      const parts = [`${i + 1}. **${item.title}**${displayDate}`];
      if (item.description) parts.push(`   ${item.description}`);
      if (item.link) parts.push(`   ${item.link}`);
      return parts.join('\n');
    });

    const header = `📡 RSS Feed: ${sourceName} (${topItems.length} items)`;
    let output = `${header}\n\n${lines.join('\n\n')}`;

    // Optionally generate LLM summary
    if (summarize) {
      const summary = await generateSummary(sourceName, topItems);
      if (summary) {
        output += `\n\n---\n🤖 **AI Summary**\n${summary}`;
      } else {
        output += '\n\n---\n_(AI summary unavailable: OPENAI_API_KEY not set or API call failed)_';
      }
    }

    return { content: output };
  },
};
