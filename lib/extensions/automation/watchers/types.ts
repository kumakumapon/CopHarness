export type WatcherType = 'manual' | 'webhook' | 'file' | 'github' | 'rss' | string;

export interface WatcherDefinition {
  id: string;
  name: string;
  type: WatcherType;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
  triggerCount: number;
  eventPattern?: string;
  discordChannelId?: string;
  lineUserId?: string;
  metadata?: Record<string, unknown>;
}

export interface WatcherStoreFile {
  watchers: WatcherDefinition[];
}

export interface WatcherEvent {
  source: string;
  type?: string;
  subject?: string;
  payload?: unknown;
  receivedAt?: string;
}
