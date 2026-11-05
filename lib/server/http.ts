/** Helpers shared by the route handlers in app/api. */
import { getRuntime, type Runtime } from '../runtime';
import type { AgentEvent, ImagePart } from '../types';
import { isAuthorized } from './auth';
import { defaultRateLimiter, rateLimitResponse, resolveRateLimitKey } from './rateLimit';

export type RouteContext<P extends Record<string, string> = Record<string, string>> = { params: Promise<P> };

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers });
}

export function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

/** Thrown by request parsing helpers; `route()` turns it into a JSON error response. */
export class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * Wrap a route handler with authentication (always on) and, for requests
 * that start work, rate limiting.
 */
export function route<P extends Record<string, string>>(
  handler: (req: Request, ctx: { runtime: Runtime; params: P }) => Promise<Response>,
  options: { rateLimit?: boolean } = {},
) {
  return async (req: Request, context: RouteContext<P>): Promise<Response> => {
    let runtime: Runtime;
    try {
      runtime = getRuntime();
    } catch (err) {
      return error(`設定エラー: ${err instanceof Error ? err.message : String(err)}`, 500);
    }
    // Header only: tokens in query strings end up in logs and browser history.
    if (!isAuthorized(req, runtime.config.dataDir)) return error('Unauthorized', 401);
    if (options.rateLimit) {
      const limited = defaultRateLimiter.consume(resolveRateLimitKey(req));
      if (!limited.allowed) return rateLimitResponse(limited);
    }
    try {
      return await handler(req, { runtime, params: (await context?.params) ?? ({} as P) });
    } catch (err) {
      if (err instanceof HttpError) return error(err.message, err.status);
      const message = err instanceof Error ? err.message : String(err);
      // Runtime and store errors use these phrasings for missing sessions and invalid input.
      const status = /見つかりません/.test(message) ? 404 : /不正|必須|cron 式/.test(message) ? 400 : 500;
      if (status === 500) console.error('[api]', err);
      return error(message, status);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as T;
  } catch {
    throw new HttpError('リクエストボディが JSON オブジェクトではありません');
  }
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Accept `images: [{mimeType, data}]` (base64) from request bodies. */
export function parseImages(raw: unknown): ImagePart[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new HttpError('images は配列である必要があります');
  return raw.slice(0, 8).map((img, i) => {
    const mimeType = String((img as ImagePart)?.mimeType ?? '');
    const data = String((img as ImagePart)?.data ?? '').replace(/^data:[^;]+;base64,/, '');
    if (!/^image\/(png|jpeg|gif|webp)$/.test(mimeType)) throw new HttpError(`images[${i}].mimeType は png / jpeg / gif / webp のいずれかです`);
    if (data.length * 0.75 > MAX_IMAGE_BYTES) throw new HttpError(`images[${i}] が大きすぎます（8MB まで）`);
    return { type: 'image', mimeType, data };
  });
}

/** Server-sent events stream. `start` receives `send` and returns a cleanup function. */
export function sse(start: (send: (event: unknown) => void, close: () => void) => (() => void) | void, headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | void;
  let keepAlive: NodeJS.Timeout | undefined;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        cleanup?.();
        try { controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); } catch { /* already closed */ }
      };
      const send = (event: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { closed = true; cleanup?.(); }
      };
      keepAlive = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch { closed = true; clearInterval(keepAlive); cleanup?.(); }
      }, 15_000);
      cleanup = start(send, close);
    },
    cancel() {
      // The client went away. Runs keep going; reconnect with GET /api/sessions/:id/events.
      clearInterval(keepAlive);
      cleanup?.();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...headers,
    },
  });
}

/** Respond to a turn either as an SSE stream of AgentEvents or, with `stream: false`, as JSON. */
export async function respondWithTurn(
  sessionId: string,
  run: (onEvent: (e: AgentEvent) => void) => Promise<unknown>,
  stream: boolean,
): Promise<Response> {
  if (!stream) {
    const result = await run(() => {});
    return json({ sessionId, ...(result as object) });
  }
  return sse((send, close) => {
    run(event => {
      send(event);
    }).then(close, err => {
      send({ type: 'notice', message: err instanceof Error ? err.message : String(err) });
      close();
    });
  }, { 'X-Session-Id': sessionId });
}
