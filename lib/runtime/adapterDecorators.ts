import type { LLMAdapter } from '../core/adapter';
import { InstrumentedAdapter } from '../extensions/telemetry/instrumentedAdapter';
import { CachedAdapter } from '../extensions/cache/cachedAdapter';
import { isCacheEnabled } from '../extensions/cache/responseCache';

export function instrumentAdapter(adapter: LLMAdapter): LLMAdapter {
  return new InstrumentedAdapter(adapter);
}

export function cacheAdapter(adapter: LLMAdapter): LLMAdapter {
  return isCacheEnabled() ? new CachedAdapter(adapter) : adapter;
}
