/**
 * Internal Event Bus — pub/sub backbone for real-time observability.
 *
 * Provides typed event emission and subscription so that dashboards,
 * loggers, and future WebSocket/SSE endpoints can react to internal
 * happenings (skill calls, adapter responses, errors, agent progress)
 * without tight coupling.
 */

export type EventType =
  | 'adapter:request'
  | 'adapter:response'
  | 'adapter:error'
  | 'skill:start'
  | 'skill:end'
  | 'skill:error'
  | 'agent:start'
  | 'agent:progress'
  | 'agent:complete'
  | 'agent:error'
  | 'watcher:trigger'
  | 'schedule:run'
  | 'schedule:complete'
  | 'system:error';

export interface BusEvent<T = unknown> {
  type: EventType;
  timestamp: string;
  payload: T;
}

export interface AdapterRequestPayload {
  provider: string;
  model: string;
  messageCount: number;
  hasSkills: boolean;
}

export interface AdapterResponsePayload {
  provider: string;
  model: string;
  durationMs: number;
  contentLength: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface AdapterErrorPayload {
  provider: string;
  model: string;
  error: string;
  durationMs: number;
  retryable: boolean;
}

export interface SkillStartPayload {
  skillName: string;
  args: Record<string, unknown>;
  taskId?: string;
}

export interface SkillEndPayload {
  skillName: string;
  durationMs: number;
  resultLength: number;
  isError: boolean;
  taskId?: string;
}

export interface SkillErrorPayload {
  skillName: string;
  error: string;
  durationMs: number;
  taskId?: string;
}

export interface AgentStartPayload {
  taskId: string;
  role: string;
  goal: string;
}

export interface AgentProgressPayload {
  taskId: string;
  iteration: number;
  message: string;
}

export interface AgentCompletePayload {
  taskId: string;
  role: string;
  durationMs: number;
  iterations: number;
  toolCallCount: number;
  completed: boolean;
}

export interface AgentErrorPayload {
  taskId: string;
  role: string;
  error: string;
  durationMs: number;
}

export interface WatcherTriggerPayload {
  watcherId: string;
  watcherName: string;
  eventSource: string;
  eventType: string;
}

export interface ScheduleRunPayload {
  scheduleId: string;
  scheduleName: string;
  prompt: string;
}

export interface ScheduleCompletePayload {
  scheduleId: string;
  scheduleName: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface SystemErrorPayload {
  source: string;
  error: string;
  fatal: boolean;
}

type EventPayloadMap = {
  'adapter:request': AdapterRequestPayload;
  'adapter:response': AdapterResponsePayload;
  'adapter:error': AdapterErrorPayload;
  'skill:start': SkillStartPayload;
  'skill:end': SkillEndPayload;
  'skill:error': SkillErrorPayload;
  'agent:start': AgentStartPayload;
  'agent:progress': AgentProgressPayload;
  'agent:complete': AgentCompletePayload;
  'agent:error': AgentErrorPayload;
  'watcher:trigger': WatcherTriggerPayload;
  'schedule:run': ScheduleRunPayload;
  'schedule:complete': ScheduleCompletePayload;
  'system:error': SystemErrorPayload;
};

export type EventListener<T extends EventType> = (event: BusEvent<EventPayloadMap[T]>) => void;

type WildcardListener = (event: BusEvent) => void;

const DEFAULT_HISTORY_SIZE = 200;

export class EventBus {
  private listeners = new Map<EventType, Set<EventListener<any>>>();
  private wildcardListeners = new Set<WildcardListener>();
  private history: BusEvent[] = [];
  private readonly maxHistory: number;

  constructor(maxHistory = DEFAULT_HISTORY_SIZE) {
    this.maxHistory = maxHistory;
  }

  emit<T extends EventType>(type: T, payload: EventPayloadMap[T]): void {
    const event: BusEvent<EventPayloadMap[T]> = {
      type,
      timestamp: new Date().toISOString(),
      payload,
    };

    this.history.push(event as BusEvent);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          listener(event);
        } catch (err) {
          console.warn(`[EventBus] Listener error on ${type}:`, err);
        }
      }
    }

    for (const listener of this.wildcardListeners) {
      try {
        listener(event as BusEvent);
      } catch (err) {
        console.warn(`[EventBus] Wildcard listener error on ${type}:`, err);
      }
    }
  }

  on<T extends EventType>(type: T, listener: EventListener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(type);
    };
  }

  onAny(listener: WildcardListener): () => void {
    this.wildcardListeners.add(listener);
    return () => {
      this.wildcardListeners.delete(listener);
    };
  }

  once<T extends EventType>(type: T, listener: EventListener<T>): () => void {
    const unsub = this.on(type, (event) => {
      unsub();
      listener(event);
    });
    return unsub;
  }

  getHistory(options?: {
    type?: EventType;
    since?: string;
    limit?: number;
  }): BusEvent[] {
    let result = this.history;
    if (options?.type) {
      result = result.filter((e) => e.type === options.type);
    }
    if (options?.since) {
      result = result.filter((e) => e.timestamp > options.since!);
    }
    if (options?.limit) {
      result = result.slice(-options.limit);
    }
    return result;
  }

  clear(): void {
    this.history = [];
  }

  removeAllListeners(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }

  listenerCount(type?: EventType): number {
    if (type) {
      return (this.listeners.get(type)?.size ?? 0) + this.wildcardListeners.size;
    }
    let total = this.wildcardListeners.size;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }
}

export const eventBus = new EventBus(
  Number(process.env.EVENT_BUS_HISTORY_SIZE) || DEFAULT_HISTORY_SIZE,
);
