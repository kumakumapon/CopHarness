import * as crypto from 'crypto';

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, string | number | boolean>;
  status: 'UNSET' | 'OK' | 'ERROR';
  statusMessage?: string;
}

export interface ActiveSpan extends Span {
  end(endAttrs?: Record<string, string | number | boolean>, error?: Error): void;
}

const MAX_BUFFER = 500;
const spanBuffer: Span[] = [];

function newHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function startSpan(
  name: string,
  attrs: Record<string, string | number | boolean> = {},
  parentSpanId?: string,
): ActiveSpan {
  const span: Span = {
    traceId: newHex(16),
    spanId: newHex(8),
    parentSpanId,
    name,
    startTime: Date.now(),
    attributes: { ...attrs },
    status: 'UNSET',
  };

  const end = (
    endAttrs: Record<string, string | number | boolean> = {},
    error?: Error,
  ) => {
    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.attributes = { ...span.attributes, ...endAttrs };
    if (error) {
      span.status = 'ERROR';
      span.statusMessage = error.message;
    } else {
      span.status = 'OK';
    }
    addToBuffer({ ...span });
    void exportSpan(span);
  };

  return Object.assign(span, { end }) as ActiveSpan;
}

function addToBuffer(span: Span): void {
  spanBuffer.push(span);
  if (spanBuffer.length > MAX_BUFFER) {
    spanBuffer.shift();
  }
}

export function getRecentSpans(limit = 100): Span[] {
  return spanBuffer.slice(-limit).reverse();
}

async function exportSpan(span: Span): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const traceEndpoint = `${endpoint.replace(/\/$/, '')}/v1/traces`;

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'copharness' } },
            { key: 'service.version', value: { stringValue: '0.1.0' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'copharness/telemetry', version: '0.1.0' },
            spans: [
              {
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                startTimeUnixNano: String(span.startTime * 1_000_000),
                endTimeUnixNano: String((span.endTime ?? span.startTime) * 1_000_000),
                kind: 3, // CLIENT
                attributes: Object.entries(span.attributes).map(([k, v]) => ({
                  key: k,
                  value:
                    typeof v === 'string'
                      ? { stringValue: v }
                      : typeof v === 'number'
                        ? { doubleValue: v }
                        : { boolValue: v },
                })),
                status: {
                  code: span.status === 'ERROR' ? 2 : span.status === 'OK' ? 1 : 0,
                  message: span.statusMessage ?? '',
                },
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    await fetch(traceEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Best-effort export; never throw
  }
}
