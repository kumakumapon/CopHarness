import type { LLMAdapter } from './adapter';
type AdapterDecorator = (adapter: LLMAdapter) => LLMAdapter;
let instrumentation: AdapterDecorator = adapter => adapter;
let caching: AdapterDecorator = adapter => adapter;

/** Called by the composition root; the core never imports optional extensions. */
export function configureAdapterDecorators(instrument: AdapterDecorator, cache: AdapterDecorator): void {
  instrumentation = instrument;
  caching = cache;
}

export const instrumentAdapter = (adapter: LLMAdapter) => instrumentation(adapter);
export const cacheAdapter = (adapter: LLMAdapter) => caching(adapter);
