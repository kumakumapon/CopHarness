/**
 * Background services for `npm run dev` / `npm start`: scheduler, Discord
 * bot and MCP connections run inside the Next.js server process.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startServices } = await import('./lib/server/services');
  await startServices();
}
