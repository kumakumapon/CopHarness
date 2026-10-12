export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWatcherAdapters } = await import('./lib/extensions/automation/watchers/adapterDaemon');
    startWatcherAdapters();
  }
}
