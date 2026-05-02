import { type SkillDefinition } from '../skill';

/**
 * Tech news skill using public RSS feeds (no API key required).
 * Inspired by the tech-news-curation skill in karaage0703/ai-assistant-workspace.
 */

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source: string;
}

/** Parse a minimal RSS 2.0 / Atom feed and extract items. */
function parseRss(xml: string, sourceName: string): RssItem[] {
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
        pubDate: pubDate.trim().slice(0, 16),
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
          pubDate: pubDate.trim().slice(0, 16),
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

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Curated list of RSS feeds for tech news. */
const FEEDS: Record<string, { url: string; name: string }[]> = {
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
};

export const techNews: SkillDefinition = {
  name: 'techNews',
  description:
    'Fetches the latest technology news headlines from public RSS feeds (no API key required). ' +
    'Topics: "ai" (AI/ML news), "tech" (general tech), "dev" (developer news/Hacker News). ' +
    'Returns titles, links, and brief descriptions.',
  parameters: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'News topic: "ai", "tech", or "dev". Defaults to "ai".',
        enum: ['ai', 'tech', 'dev'],
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of news items to return (1–10). Defaults to 5.',
        minimum: 1,
        maximum: 10,
      },
    },
    required: [],
  },
  category: 'web',
  riskLevel: 'low',
  handler: async (args) => {
    const topic = ['ai', 'tech', 'dev'].includes(String(args.topic ?? '')) ? String(args.topic) : 'ai';
    const maxResults = typeof args.maxResults === 'number'
      ? Math.min(10, Math.max(1, Math.floor(args.maxResults)))
      : 5;

    const feeds = FEEDS[topic];
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

    if (allItems.length === 0) {
      return { content: `No news items found for topic "${topic}". The RSS feeds may be temporarily unavailable.` };
    }

    const topItems = allItems.slice(0, maxResults);
    const lines = topItems.map((item, i) => {
      const parts = [
        `${i + 1}. **${item.title}**`,
        `   Source: ${item.source}${item.pubDate ? `  |  ${item.pubDate}` : ''}`,
      ];
      if (item.description) parts.push(`   ${item.description}`);
      if (item.link) parts.push(`   ${item.link}`);
      return parts.join('\n');
    });

    return {
      content: `📰 Latest ${topic.toUpperCase()} news (${topItems.length} items):\n\n${lines.join('\n\n')}`,
    };
  },
};
