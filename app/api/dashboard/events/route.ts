import { eventBus } from '@/lib/events/bus';
import type { BusEvent, EventType } from '@/lib/events/bus';
import { requireApiKey } from '@/lib/apiAuth';
import { redactBusEvent } from '@/lib/events/redact';

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

  // `EventSource` cannot set an Authorization header, so we allow the API key
  // to be supplied as a query parameter — but only when the operator has
  // explicitly opted in via DASHBOARD_EVENTS_ALLOW_QUERY_TOKEN. Default-off is
  // deliberate: URL-embedded credentials leak into access logs, so operators
  // must opt in to enable browser EventSource subscriptions.
  const queryToken =
    process.env.DASHBOARD_EVENTS_ALLOW_QUERY_TOKEN === 'true'
      ? url.searchParams.get('access_token')
      : null;
  const authError = requireApiKey(request, queryToken);
  if (authError) return authError;

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
          const redacted = redactBusEvent(event);
          const data = JSON.stringify(redacted);
          controller.enqueue(encoder.encode(`event: ${redacted.type}\ndata: ${data}\n\n`));
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
  const authError = requireApiKey(request);
  if (authError) return authError;

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

  const events = history.map(redactBusEvent);

  return Response.json({ events, count: events.length });
}
