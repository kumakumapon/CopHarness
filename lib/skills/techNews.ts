import { type SkillDefinition } from '../skill';
import { stripHtml } from '../utils/html';

/**
 * Tech news skill using public RSS feeds (no API key required).
 * Inspired by the tech-news-curation skill in karaage0703/ai-assistant-workspace.
 */

export interface RssItem {
  title: string;
  link: string;
  /** Full publication date string (used for sorting). */
  pubDate: string;
  description: string;
  source: string;
}

/** Parse a minimal RSS 2.0 / Atom feed and extract items. */
export function parseRss(xml: string, sourceName: string): RssItem[] {
  const items: RssItem[] = [];

  // Try RSS 2.0 <item> elements first
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link') || extractAttr(block, 'link', 'href');
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated');
    const description = extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content');
    if (title) {
      items.push({
        title: stripHtml(title),
        link: link.trim(),
        pubDate: pubDate.trim(),
        description: stripHtml(description).slice(0, 200),
        source: sourceName,
      });
    }
  }

  // Try Atom <entry> elements if no RSS items found
  if (items.length === 0) {
    const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
    for (const match of entryMatches) {
      const block = match[1];
      const title = extractTag(block, 'title');
      const link = extractAttr(block, 'link', 'href') || extractTag(block, 'link');
      const pubDate = extractTag(block, 'published') || extractTag(block, 'updated');
      const description = extractTag(block, 'summary') || extractTag(block, 'content');
      if (title) {
        items.push({
          title: stripHtml(title),
          link: link.trim(),
          pubDate: pubDate.trim(),
          description: stripHtml(description).slice(0, 200),
          source: sourceName,
        });
      }
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:[^>]*)><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'))
    ?? xml.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

/** Curated list of RSS feeds for tech news. */
export const FEEDS: Record<string, { url: string; name: string }[]> = {
  ai: [
    { url: 'https://feeds.feedburner.com/venturebeat/SRLB', name: 'VentureBeat AI' },
    { url: 'https://www.artificialintelligence-news.com/feed/', name: 'AI News' },
  ],
  tech: [
    { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica' },
    { url: 'https://www.wired.com/feed/rss', name: 'Wired' },
  ],
  dev: [
    { url: 'https://hnrss.org/frontpage', name: 'Hacker News' },
    { url: 'https://dev.to/feed', name: 'DEV Community' },
  ],
  world: [
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC World' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', name: 'NYT World' },
  ],
  finance: [
    { url: 'https://feeds.reuters.com/reuters/businessNews', name: 'Reuters Business' },
    { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', name: 'MarketWatch' },
  ],
  science: [
    { url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', name: 'NASA News' },
    { url: 'https://www.sciencedaily.com/rss/all.xml', name: 'ScienceDaily' },
  ],
  japan: [
    { url: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/', name: 'NHK World' },
    { url: 'https://japantoday.com/feed', name: 'Japan Today' },
  ],
};

/** All valid topic names for techNews / newsBrief. */
export const NEWS_TOPICS = Object.keys(FEEDS) as (keyof typeof FEEDS)[];

/**
 * Fetch and parse all RSS items for the given feeds list.
 * Returns items sorted newest-first (items without a parseable date sort last).
 */
export async function fetchFeedItems(feeds: { url: string; name: string }[]): Promise<RssItem[]> {
  const allItems: RssItem[] = [];

  await Promise.all(
    feeds.map(async ({ url, name }) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        let response: Response;
        try {
          response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'CopHarness/1.0 (RSS reader)' },
          });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) return;
        const text = await response.text();
        const items = parseRss(text, name);
        allItems.push(...items);
      } catch {
        // Silently skip failed feeds
      }
    }),
  );

  // Sort newest-first; items with an unparseable date go to the end
  allItems.sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  });

  return allItems;
}

/** Format an RssItem for display (0-indexed position). */
function formatItem(item: RssItem, index: number): string {
  const displayDate = item.pubDate ? item.pubDate.slice(0, 16) : '';
  const parts = [
    `${index + 1}. **${item.title}**`,
    `   Source: ${item.source}${displayDate ? `  |  ${displayDate}` : ''}`,
  ];
  if (item.description) parts.push(`   ${item.description}`);
  if (item.link) parts.push(`   ${item.link}`);
  return parts.join('\n');
}

export const techNews: SkillDefinition = {
  name: 'techNews',
  description:
    'Fetches the latest news headlines from public RSS feeds (no API key required). ' +
    'Topics: "ai" (AI/ML), "tech" (general tech), "dev" (developer/Hacker News), ' +
    '"world" (international news), "finance" (business/markets), ' +
    '"science" (NASA/ScienceDaily), "japan" (NHK World/Japan Today). ' +
    'Provide a single "topic" for a focused feed, or a "topics" array for a multi-topic digest (replaces newsBrief). ' +
    'Returns titles, links, and brief descriptions sorted newest-first.',
  parameters: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'News topic for a single-topic feed. One of: "ai", "tech", "dev", "world", "finance", "science", "japan". Defaults to "ai". Ignored when "topics" is provided.',
        enum: NEWS_TOPICS,
      },
      topics: {
        type: 'array',
        description:
          'List of news topics for a multi-topic digest. Each element must be one of: ' +
          '"ai", "tech", "dev", "world", "finance", "science", "japan". ' +
          'When provided, returns a combined digest formatted per-topic. Defaults to ["ai", "tech"] when given an empty array.',
        items: {
          type: 'string',
          description: 'A news topic name.',
        },
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of news items to return per topic (1–10). Defaults to 5 for single-topic, 3 for multi-topic.',
        minimum: 1,
        maximum: 10,
      },
    },
    required: [],
  },
  category: 'web',
  riskLevel: 'low',
  handler: async (args) => {
    // Multi-topic digest mode when "topics" array is provided
    if (Array.isArray(args.topics)) {
      const rawTopics = (args.topics as unknown[]).map(String);
      const validTopics = rawTopics.filter((t) =>
        NEWS_TOPICS.includes(t as keyof typeof FEEDS),
      );
      const topics = validTopics.length > 0 ? validTopics : ['ai', 'tech'];

      const maxPerTopic = typeof args.maxResults === 'number'
        ? Math.min(10, Math.max(1, Math.floor(args.maxResults)))
        : 3;

      const sections: string[] = [];

      const results = await Promise.all(
        topics.map(async (topic) => {
          const feeds = FEEDS[topic];
          const items = await fetchFeedItems(feeds);
          return { topic, items: items.slice(0, maxPerTopic) };
        }),
      );

      for (const { topic, items } of results) {
        if (items.length === 0) {
          sections.push(`### ${topic.toUpperCase()}\n_(No items available)_`);
          continue;
        }
        const lines = items.map((item) => {
          const displayDate = item.pubDate ? ` (${item.pubDate.slice(0, 16)})` : '';
          const parts = [`- **${item.title}**${displayDate} — ${item.source}`];
          if (item.description) parts.push(`  ${item.description}`);
          if (item.link) parts.push(`  ${item.link}`);
          return parts.join('\n');
        });
        sections.push(`### ${topic.toUpperCase()}\n${lines.join('\n\n')}`);
      }

      const totalItems = results.reduce((sum, r) => sum + r.items.length, 0);
      const header = `📋 News Brief — ${topics.map((t) => t.toUpperCase()).join(', ')} (${totalItems} items total)`;

      return {
        content: `${header}\n\n${sections.join('\n\n')}`,
      };
    }

    // Single-topic mode
    const topic = NEWS_TOPICS.includes(String(args.topic ?? '') as keyof typeof FEEDS)
      ? String(args.topic)
      : 'ai';
    const maxResults = typeof args.maxResults === 'number'
      ? Math.min(10, Math.max(1, Math.floor(args.maxResults)))
      : 5;

    const feeds = FEEDS[topic];
    const allItems = await fetchFeedItems(feeds);

    if (allItems.length === 0) {
      return { content: `No news items found for topic "${topic}". The RSS feeds may be temporarily unavailable.` };
    }

    const topItems = allItems.slice(0, maxResults);
    const lines = topItems.map((item, i) => formatItem(item, i));

    return {
      content: `📰 Latest ${topic.toUpperCase()} news (${topItems.length} items):\n\n${lines.join('\n\n')}`,
    };
  },
};
