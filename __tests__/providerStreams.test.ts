/**
 * Drive the real SDKs against local fake endpoints to check stream parsing,
 * native replay content and usage mapping without calling external services.
 */
import * as http from 'node:http';
import { AnthropicProvider } from '../lib/providers/anthropic';
import { OpenAIProvider } from '../lib/providers/openai';
import type { ModelEvent } from '../lib/providers/types';

type Handler = (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void;

async function serve(handler: Handler): Promise<{ url: string; requests: Array<{ url: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }>; close(): Promise<void> }> {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      requests.push({ url: req.url ?? '', body: body ? JSON.parse(body) : {}, headers: req.headers });
      handler(req, body, res);
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise(r => server.close(() => r())) };
}

const sse = (res: http.ServerResponse, events: Array<[string | undefined, unknown]>) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const [name, data] of events) res.write(`${name ? `event: ${name}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
  res.end();
};

describe('Anthropic stream', () => {
  it('collects thinking, text and tool use and keeps the native blocks', async () => {
    const server = await serve((_req, _body, res) => sse(res, [
      ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan it' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG123' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Reading ' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'the file.' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 1 }],
      ['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 2 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 42 } }],
      ['message_stop', { type: 'message_stop' }],
    ]));
    try {
      const provider = new AnthropicProvider({ apiKey: 'test', baseUrl: server.url, timeoutMs: 10_000 });
      const events: ModelEvent[] = [];
      const result = await provider.stream({ model: 'claude-opus-5-5', system: 'sys', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: [{ name: 'read_file', description: 'r', inputSchema: { type: 'object' } }] }, e => events.push(e));
      expect(events).toEqual([
        { type: 'reasoning_delta', text: 'plan it' },
        { type: 'text_delta', text: 'Reading ' },
        { type: 'text_delta', text: 'the file.' },
      ]);
      expect(result.stopReason).toBe('tool_use');
      expect(result.message.content).toEqual([
        { type: 'reasoning', text: 'plan it' },
        { type: 'text', text: 'Reading the file.' },
        { type: 'tool_call', id: 'toolu_1', name: 'read_file', input: { path: 'a.txt' } },
      ]);
      const native = result.message.native!.content as Array<Record<string, unknown>>;
      expect(native[0]).toMatchObject({ type: 'thinking', signature: 'SIG123' });
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 42, cacheReadTokens: 50, cacheWriteTokens: 10 });
      const sent = server.requests[0].body;
      expect(sent).toMatchObject({ model: 'claude-opus-5-5', stream: true, cache_control: { type: 'ephemeral' }, thinking: { type: 'adaptive' } });
      expect(sent.system).toEqual([{ type: 'text', text: 'sys' }]);
    } finally {
      await server.close();
    }
  });
});

describe('OpenAI-compatible stream', () => {
  it('assembles streamed tool call arguments and reasoning from local servers', async () => {
    const chunk = (delta: unknown, finish: string | null = null) => [undefined, { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] }] as [undefined, unknown];
    const server = await serve((_req, _body, res) => sse(res, [
      chunk({ role: 'assistant', reasoning_content: 'hmm' }),
      chunk({ content: 'ok' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'grep', arguments: '{"pat' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'tern":"x"}' } }] }),
      chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'list_files', arguments: 'not json' } }] }),
      chunk({}, 'tool_calls'),
      [undefined, { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, prompt_tokens_details: { cached_tokens: 8 } } }],
    ]));
    try {
      const provider = new OpenAIProvider({ apiKey: '', baseUrl: `${server.url}/v1`, timeoutMs: 10_000, streamUsage: true });
      const events: ModelEvent[] = [];
      const r = await provider.stream({ model: 'local', system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }], tools: [] }, e => events.push(e));
      expect(events[0]).toEqual({ type: 'reasoning_delta', text: 'hmm' });
      expect(r.message.content).toEqual([
        { type: 'text', text: 'ok' },
        { type: 'tool_call', id: 'call_a', name: 'grep', input: { pattern: 'x' } },
        { type: 'tool_call', id: 'call_b', name: 'list_files', input: { __invalid_json__: 'not json' } },
      ]);
      expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 5, cacheReadTokens: 8, cacheWriteTokens: 0 });
      expect(server.requests[0].body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    } finally {
      await server.close();
    }
  });
});
