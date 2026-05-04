import { type SkillDefinition } from '../skill';
import { FEEDS, NEWS_TOPICS, fetchFeedItems } from './techNews';

/**
 * News brief skill — fetches a multi-topic news digest in one call.
 * Internally uses the same RSS feeds as techNews but aggregates across
 * multiple topics and formats the result as a compact digest.
 */

export const newsBrief: SkillDefinition = {
  name: 'newsBrief',
  description:
    'Fetches a multi-topic news digest from public RSS feeds (no API key required). ' +
    'Provide an array of topics to receive a combined summary. ' +
    'Available topics: "ai", "tech", "dev", "world", "finance", "science", "japan". ' +
    'Returns a compact digest sorted newest-first within each topic.',
  parameters: {
    type: 'object',
    properties: {
      topics: {
        type: 'array',
        description:
          'List of news topics to include. Each element must be one of: ' +
          '"ai", "tech", "dev", "world", "finance", "science", "japan". ' +
          'Defaults to ["ai", "tech"] when not provided.',
        items: {
          type: 'string',
          description: 'A news topic name.',
        },
      },
      maxPerTopic: {
        type: 'number',
        description: 'Maximum number of items to include per topic (1–10). Defaults to 3.',
        minimum: 1,
        maximum: 10,
      },
    },
    required: [],
  },
  category: 'web',
  riskLevel: 'low',
  handler: async (args) => {
    // Resolve and validate the topics list
    const rawTopics = Array.isArray(args.topics) ? (args.topics as unknown[]).map(String) : [];
    const validTopics = rawTopics.filter((t) =>
      NEWS_TOPICS.includes(t as keyof typeof FEEDS),
    );
    const topics = validTopics.length > 0 ? validTopics : ['ai', 'tech'];

    const maxPerTopic = typeof args.maxPerTopic === 'number'
      ? Math.min(10, Math.max(1, Math.floor(args.maxPerTopic)))
      : 3;

    const sections: string[] = [];

    // Fetch each topic in parallel
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
  },
};
