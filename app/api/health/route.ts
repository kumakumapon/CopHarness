export const dynamic = 'force-dynamic';

/** Liveness probe (no authentication). */
export function GET() {
  return Response.json({ ok: true, name: 'copharness', version: 2 });
}
