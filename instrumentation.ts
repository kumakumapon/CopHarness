import { isMinimalRuntime } from './lib/core/runtimeProfile';
export async function register() {
  if (!isMinimalRuntime() && process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWatcherAdapters } = await import('./lib/extensions/automation/watchers/adapterDaemon');
    startWatcherAdapters();
  }
}
