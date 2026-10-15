/** Composition root. Minimal mode never loads extension skill packs or decorators. */
import './core/skills/index';
import { isMinimalRuntime } from './core/runtimeProfile';
import { configureAdapterDecorators } from './core/adapterDecorators';

if (!isMinimalRuntime()) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerExtensions } = require('./runtime/fullBootstrap') as typeof import('./runtime/fullBootstrap');
  registerExtensions();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { instrumentAdapter, cacheAdapter } = require('./runtime/adapterDecorators') as typeof import('./runtime/adapterDecorators');
  configureAdapterDecorators(instrumentAdapter, cacheAdapter);
}
