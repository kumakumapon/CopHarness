import { eventBus } from '@/lib/events/bus';
import type { BusEvent, EventType } from '@/lib/events/bus';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/events
 *
 * Server-Sent Events endpoint for real-time event streaming.
 * Query params:
 *   - types: comma-separated event types to filter (optional, default: all)
 *   - since: ISO timestamp to replay history from (optional)
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const typesParam = url.searchParams.get('types');
  const since = url.searchParams.get('since') ?? undefined;

  const filterTypes: EventType[] | undefined = typesParam
    ? (typesParam.split(',').map((s) => s.trim()) as EventType[])
    : undefined;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: BusEvent) => {
        if (closed) return;
        if (filterTypes && !filterTypes.includes(event.type)) return;
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
        } catch {
          // Stream may be closed
        }
      };

      // Replay history if requested
      if (since) {
        const history = eventBus.getHistory({ since });
        for (const event of history) {
          send(event);
        }
      }

      // Subscribe to live events
      unsubscribe = eventBus.onAny(send);

      // Send keepalive comment every 30s
      const keepalive = setInterval(() => {
        if (closed) {
          clearInterval(keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 30_000);

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(keepalive);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      closed = true;
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * GET /api/dashboard/events (when Accept is application/json)
 * Returns recent event history as JSON.
 *
 * Since Next.js route handlers don't support content negotiation easily,
 * we expose this as a POST endpoint for JSON history queries.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    type?: EventType;
    since?: string;
    limit?: number;
  };

  const history = eventBus.getHistory({
    type: body.type,
    since: body.since,
    limit: body.limit ?? 100,
  });

  return Response.json({ events: history, count: history.length });
}
