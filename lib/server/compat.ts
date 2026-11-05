/** Translate the stateless v1 `/api/copilot` request into a seeded session. */
import type { Runtime } from '../runtime';
import type { ImagePart, Message } from '../types';
import { HttpError, parseImages, readJson } from './http';

interface V1Message { role?: string; content?: unknown }

export async function compatRequest(runtime: Runtime, req: Request): Promise<{ sessionId: string; text: string; images: ImagePart[] }> {
  const body = await readJson<{ messages?: V1Message[]; attachments?: Array<{ data?: string; mimeType?: string }>; subject?: string }>(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  if (!messages.length || last?.role !== 'user' || typeof last.content !== 'string') {
    throw new HttpError('messages は必須で、最後は role "user" のメッセージである必要があります');
  }
  const instructions = messages.filter(m => m.role === 'system' && typeof m.content === 'string').map(m => m.content as string).join('\n\n');
  const history: Message[] = messages.slice(0, -1)
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: [{ type: 'text', text: m.content as string }] }));
  const images = parseImages(body.attachments?.map(a => ({ mimeType: a.mimeType, data: a.data })));
  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : (req.headers.get('x-copharness-subject') ?? 'anonymous');
  const sessionId = await runtime.createSession({ owner: `api:${subject}`, title: last.content, instructions: instructions || undefined, history });
  return { sessionId, text: last.content, images };
}
