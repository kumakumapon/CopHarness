/**
 * searchHistory skill — lexical FTS search over indexed conversation messages
 * and TaskLedger tasks using the SearchIndex (SQLite FTS5 / JSON fallback).
 */

import { type SkillDefinition } from '../skill';
import { getSearchIndex, isSearchIndexEnabled, type SearchDocType } from '../search/index';

export const searchHistory: SkillDefinition = {
  name: 'searchHistory',
  description:
    'Searches indexed conversation messages and task records using full-text search (BM25 lexical, not semantic). Returns a ranked list of matching snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Full-text search query.',
      },
      type: {
        type: 'string',
        enum: ['conversation', 'task'],
        description: 'Optional filter: "conversation" or "task".',
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 20,
        description: 'Maximum number of results to return (default 10, max 20).',
      },
    },
    required: ['query'],
  },
  category: 'memory',
  riskLevel: 'low',
  handler: async (args) => {
    const query = String(args.query ?? '').trim();
    if (!query) return { content: 'Error: query は必須です', isError: true };

    if (!isSearchIndexEnabled()) {
      return { content: '検索インデックスは無効化されています（SEARCH_INDEX_ENABLED=false）。' };
    }

    try {
      const rawType = String(args.type ?? '').trim() as SearchDocType | '';
      const type: SearchDocType | undefined =
        rawType === 'conversation' || rawType === 'task' ? rawType : undefined;
      const limit = args.limit !== undefined ? Math.min(20, Math.max(1, Number(args.limit))) : 10;

      const index = getSearchIndex();
      const hits = index.search({ query, type, limit });

      if (hits.length === 0) {
        return { content: '該当する検索結果が見つかりませんでした。' };
      }

      const lines = hits.map((hit, i) => {
        const typeLabel = hit.type === 'conversation' ? '会話' : 'タスク';
        const ref =
          hit.type === 'conversation'
            ? `conversationKey=${hit.conversationKey ?? '?'}${hit.role ? ` role=${hit.role}` : ''}`
            : `taskId=${hit.taskId ?? '?'}`;
        const dateStr = hit.createdAt ? new Date(hit.createdAt).toLocaleString('ja-JP') : '?';
        return `${i + 1}. [${typeLabel}] (${dateStr}) ${ref}\n   ${hit.snippet}`;
      });

      return { content: lines.join('\n\n') };
    } catch (err) {
      return {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};
