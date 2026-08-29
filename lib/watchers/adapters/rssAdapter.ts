import * as fs from 'fs';
import { dataPath } from '../../utils/dataDir';
import { safeFetch } from '../../utils/urlGuard';
import { dispatchWatcherEvent } from '../engine';
import type { WatcherDefinition } from '../types';

const DEFAULT_POLL_INTERVAL_MS = parseInt(
  process.env.RSS_WATCHER_DEFAULT_INTERVAL_MS ?? '900000',
  10,
);
const FETCH_TIMEOUT_MS = 10_000;

interface RssItem {
  guid: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

function extractTagContent(xml: string, tag: string): string {
  // Match both <tag>content</tag> and <tag attr="...">content</tag>
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  // Strip CDATA wrappers if present
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)]]>$/, '$1').trim();
}

function extractAttrOrContent(xml: string, tag: string, attr: string): string {
  // Try to get attribute value first (e.g. <link href="..."/>)
  const attrRe = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
  const attrMatch = xml.match(attrRe);
  if (attrMatch) return attrMatch[1].trim();
  return extractTagContent(xml, tag);
}

function splitItems(xml: string): string[] {
  // Support both RSS <item> and Atom <entry>
  const items: string[] = [];
  for (const tag of ['item', 'entry']) {
    const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      items.push(m[0]);
    }
    if (items.length > 0) break;
  }
  return items;
}

function parseItems(xml: string): RssItem[] {
  return splitItems(xml).map((block) => {
    // Guid: RSS uses <guid>, Atom uses <id>
    const guid =
      extractTagContent(block, 'guid') ||
      extractTagContent(block, 'id') ||
      extractAttrOrContent(block, 'link', 'href') ||
      '';

    const title = extractTagContent(block, 'title');

    // Link: Atom uses <link href="..."/> or <link>...</link>; RSS uses <link>
    const link =
      extractAttrOrContent(block, 'link', 'href') ||
      extractTagContent(block, 'link') ||
      '';

    // Description: RSS uses <description>, Atom uses <summary> or <content>
    const description =
      extractTagContent(block, 'description') ||
      extractTagContent(block, 'summary') ||
      extractTagContent(block, 'content') ||
      '';

    // PubDate: RSS uses <pubDate>, Atom uses <updated> or <published>
    const pubDate =
      extractTagContent(block, 'pubDate') ||
      extractTagContent(block, 'updated') ||
      extractTagContent(block, 'published') ||
      '';

    return { guid: guid || link || title, title, link, description, pubDate };
  });
}

function seenFilePath(watcherId: string): string {
  return dataPath(`rss_seen_${watcherId}.json`);
}

function loadSeenGuids(watcherId: string): Set<string> {
  const filePath = seenFilePath(watcherId);
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(parsed as string[]);
      }
    }
  } catch {
    // Ignore - start fresh
  }
  return new Set<string>();
}

function saveSeenGuids(watcherId: string, guids: Set<string>): void {
  try {
    fs.writeFileSync(seenFilePath(watcherId), JSON.stringify([...guids], null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error(`[RssAdapter:${watcherId}] Failed to save seen GUIDs:`, err);
  }
}

export class RssWatcherAdapter {
  private readonly watcher: WatcherDefinition;
  private readonly feedUrl: string;
  private readonly pollIntervalMs: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(watcher: WatcherDefinition) {
    this.watcher = watcher;
    const meta = watcher.metadata ?? {};
    this.feedUrl = typeof meta['feedUrl'] === 'string' ? meta['feedUrl'] : '';
    this.pollIntervalMs =
      typeof meta['pollIntervalMs'] === 'number'
        ? meta['pollIntervalMs']
        : DEFAULT_POLL_INTERVAL_MS;
  }

  start(): void {
    if (!this.feedUrl) {
      console.warn(`[RssAdapter:${this.watcher.id}] No feedUrl configured, skipping.`);
      return;
    }
    // Poll immediately then on interval
    void this.pollNow();
    this.intervalHandle = setInterval(() => {
      void this.pollNow();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async pollNow(): Promise<void> {
    if (!this.feedUrl) return;
    let xml: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await safeFetch(this.feedUrl, { signal: controller.signal });
        xml = await response.text();
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      console.error(`[RssAdapter:${this.watcher.id}] Fetch error for ${this.feedUrl}:`, err);
      return;
    }

    let items: RssItem[];
    try {
      items = parseItems(xml);
    } catch (err) {
      console.error(`[RssAdapter:${this.watcher.id}] Parse error:`, err);
      return;
    }

    const seenGuids = loadSeenGuids(this.watcher.id);
    const newItems = items.filter((item) => item.guid && !seenGuids.has(item.guid));

    for (const item of newItems) {
      try {
        await dispatchWatcherEvent({
          source: 'rss',
          type: 'new_item',
          subject: item.link || item.guid,
          payload: {
            title: item.title,
            link: item.link,
            description: item.description,
            pubDate: item.pubDate,
            watcherId: this.watcher.id,
            feedUrl: this.feedUrl,
          },
        });
        seenGuids.add(item.guid);
      } catch (err) {
        console.error(`[RssAdapter:${this.watcher.id}] Dispatch error for item ${item.guid}:`, err);
      }
    }

    if (newItems.length > 0) {
      saveSeenGuids(this.watcher.id, seenGuids);
    }
  }
}
