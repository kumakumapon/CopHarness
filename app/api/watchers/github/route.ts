import * as crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { dispatchWatcherEvent } from '../../../../lib/watchers/engine';
import { normalizeGitHubWebhookEvent } from '../../../../lib/watchers/github';

function verifyGitHubSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export async function POST(req: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 });
  }

  const signature = req.headers.get('X-Hub-Signature-256');

  if (secret) {
    if (!signature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    if (!verifyGitHubSignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    console.warn('[github webhook] GITHUB_WEBHOOK_SECRET is not configured — skipping signature verification');
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid JSON body: expected an object' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const githubEvent = req.headers.get('X-GitHub-Event') ?? 'unknown';
  const deliveryId = req.headers.get('X-GitHub-Delivery') ?? undefined;

  const event = normalizeGitHubWebhookEvent({
    eventName: githubEvent,
    deliveryId,
    payload: body,
  });

  const dispatch = await dispatchWatcherEvent(event);
  const failed = dispatch.results.filter((result) => !result.ok).length;

  const response: Record<string, unknown> = {
    ok: failed === 0,
    matched: dispatch.matched,
    failed,
    event: dispatch.event,
    results: dispatch.results,
    deliveryId,
  };

  if (!secret) {
    response.warning = 'GITHUB_WEBHOOK_SECRET is not configured — signature verification was skipped';
  }

  return NextResponse.json(response, { status: failed > 0 ? 207 : 200 });
}
