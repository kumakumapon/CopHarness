import { safeFetch, UnsafeUrlError } from '../util/urlGuard';
import { stripHtml } from '../util/html';
import { str, truncateMiddle, type Tool } from './types';

const DEFAULT_MAX = 20_000;

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: 'URL の内容を取得してテキストで返す（HTML は本文テキストに変換）。社内ネットワークやループバック宛ては拒否される。',
  access: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'http(s) URL' },
      max_chars: { type: 'integer', minimum: 500, maximum: 100_000 },
    },
    required: ['url'],
  },
  subject: input => {
    try { return new URL(str(input.url)).hostname; } catch { return undefined; }
  },
  summarize: input => str(input.url),
  async run(input, ctx) {
    const max = Number(input.max_chars) || DEFAULT_MAX;
    const timeout = AbortSignal.timeout(30_000);
    try {
      const res = await safeFetch(str(input.url), {
        signal: AbortSignal.any([ctx.signal, timeout]),
        headers: { 'User-Agent': 'CopHarness/2 (+https://github.com/kumakumapon/copharness)', Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5' },
      });
      const type = res.headers.get('content-type') ?? '';
      if (!/text|json|xml|javascript/.test(type)) {
        return { content: `[${res.status}] テキスト以外の内容です（${type || '不明'}）。`, isError: !res.ok };
      }
      const raw = await res.text();
      const body = /html/.test(type) ? stripHtml(raw) : raw;
      return { content: `[${res.status}] ${res.url}\n\n${truncateMiddle(body.trim(), max)}`, isError: !res.ok };
    } catch (err) {
      if (err instanceof UnsafeUrlError) return { content: `取得を拒否しました: ${err.message}`, isError: true };
      return { content: `取得に失敗しました: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
