/**
 * Runs the Gemini provider against a local fake endpoint in a plain Node process
 * (via tsx). Jest's sandbox lacks undici's global dispatcher, which @google/genai needs.
 * Prints the result as JSON.
 */
import * as http from 'node:http';
import { GeminiProvider } from '../../lib/providers/gemini';

const sse = (res: http.ServerResponse, events: unknown[]) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const data of events) res.write(`data: ${JSON.stringify(data)}\n\n`);
  res.end();
};

const requests: string[] = [];
const server = http.createServer((req, res) => {
  requests.push(req.url ?? '');
  req.resume();
  sse(res, [
    { candidates: [{ content: { role: 'model', parts: [{ text: 'thinking...', thought: true }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'Let me check.' }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'b' } }, thoughtSignature: 'TS' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 7, thoughtsTokenCount: 3, cachedContentTokenCount: 10 } },
  ]);
});

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address() as { port: number };
  const provider = new GeminiProvider({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 10_000 });
  const events: unknown[] = [];
  const result = await provider.stream({
    model: 'gemini-2.5-flash', system: 's',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
    tools: [{ name: 'read_file', description: 'r', inputSchema: { type: 'object' } }],
  }, e => events.push(e));
  process.stdout.write(JSON.stringify({ events, result, requests }));
  server.close();
});
