import { type SkillDefinition } from '../skill';
import { parseRss } from './techNews';

/**
 * Trend search skill using the Google Trends daily RSS feed.
 * No API key required — uses the public Google Trends RSS endpoint.
 * Reference: https://trends.google.com/trends/trendingsearches/daily/rss?geo=JP
 */

/**
 * Supported region codes.
 * Use ISO 3166-1 alpha-2 country codes (e.g. JP, US, GB, DE, FR, AU, CA, KR, IN).
 */
const DEFAULT_REGION = 'JP';
const TRENDS_RSS_URL = (geo: string) =>
  `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo.toUpperCase()}`;

/** Extract the numeric traffic approximation from a <ht:approx_traffic> tag. */
function extractApproxTraffic(block: string): string {
  const m = block.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/i);
  return m ? m[1].trim() : '';
}

/** Extract the news article titles listed under a trending topic. */
function extractNewsItems(block: string): string[] {
  const items: string[] = [];
  const articleMatches = block.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/gi);
  for (const m of articleMatches) {
    const titleM = m[1].match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/i);
    if (titleM) {
      // Unwrap CDATA, then strip tags in multiple passes to handle nested/malformed tags
      let text = titleM[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
      let prev = '';
      while (prev !== text) {
        prev = text;
        text = text.replace(/<[^>]*>/g, '');
      }
      const title = text.trim();
      if (title) items.push(title);
    }
  }
  return items;
}

interface TrendItem {
  keyword: string;
  approxTraffic: string;
  newsItems: string[];
  link: string;
}

/** Parse the Google Trends RSS feed into TrendItem list. */
function parseTrendsRss(xml: string): TrendItem[] {
  const items: TrendItem[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const m of itemMatches) {
    const block = m[1];
    // Title is the trending keyword
    const titleM = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    if (!titleM) continue;
    const keyword = titleM[1].trim();
    const approxTraffic = extractApproxTraffic(block);
    const newsItems = extractNewsItems(block);
    // Fallback link via parseRss-compatible extraction
    const linkM = block.match(/<link>([\s\S]*?)<\/link>/i);
    const link = linkM ? linkM[1].trim() : '';
    items.push({ keyword, approxTraffic, newsItems, link });
  }
  return items;
}

export const trendSearch: SkillDefinition = {
  name: 'trendSearch',
  description:
    'Fetches the current trending search topics from Google Trends for a given region. ' +
    'No API key required. Returns trending keywords with approximate search volume and ' +
    'related news headlines.',
  parameters: {
    type: 'object',
    properties: {
      region: {
        type: 'string',
        description:
          'ISO 3166-1 alpha-2 country code for the region to fetch trends from (e.g. "JP", "US", "GB", "DE", "KR"). Defaults to "JP".',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of trending topics to return (1–25). Defaults to 10.',
        minimum: 1,
        maximum: 25,
      },
    },
    required: [],
  },
  category: 'web',
  riskLevel: 'low',
  handler: async (args) => {
    const region = typeof args.region === 'string' && args.region.trim()
      ? args.region.trim().toUpperCase().slice(0, 2)
      : DEFAULT_REGION;
    const maxResults = typeof args.maxResults === 'number'
      ? Math.min(25, Math.max(1, Math.floor(args.maxResults)))
      : 10;

    const url = TRENDS_RSS_URL(region);
    let xml: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'CopHarness/1.0 (Trends RSS reader)' },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        return {
          content: `Error: Google Trends RSS returned ${response.status} ${response.statusText}`,
          isError: true,
        };
      }
      xml = await response.text();
    } catch (err) {
      return {
        content: `Error fetching Google Trends: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    const trends = parseTrendsRss(xml).slice(0, maxResults);

    if (trends.length === 0) {
      // Fallback: try to parse as a generic RSS feed in case the format changed
      const fallback = parseRss(xml, `Google Trends (${region})`);
      if (fallback.length === 0) {
        return {
          content: `No trending topics found for region "${region}". The feed may be temporarily unavailable.`,
        };
      }
      const lines = fallback.slice(0, maxResults).map((item, i) => `${i + 1}. ${item.title}`);
      return {
        content: `🔥 Trending searches in ${region} (${lines.length} topics):\n\n${lines.join('\n')}`,
      };
    }

    const lines = trends.map((t, i) => {
      const parts = [`${i + 1}. **${t.keyword}**`];
      if (t.approxTraffic) parts.push(`   Approx. searches: ${t.approxTraffic}`);
      if (t.newsItems.length > 0) {
        parts.push(`   Related news: ${t.newsItems.slice(0, 3).join(' / ')}`);
      }
      if (t.link) parts.push(`   ${t.link}`);
      return parts.join('\n');
    });

    return {
      content: `🔥 Trending searches in ${region} (${trends.length} topics):\n\n${lines.join('\n\n')}`,
    };
  },
};
