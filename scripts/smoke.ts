/**
 * End-to-end smoke test against the production build (run `npm run build` first).
 * A local fake OpenAI-compatible server stands in for the LLM; no external calls are made.
 *
 *   npm run build && npm run smoke
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

type Json = Record<string, unknown>;

function fakeLlm(): Promise<{ url: string; close(): void }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const request = JSON.parse(body || '{}') as { messages: Array<{ role: string; content: unknown }> };
      const last = request.messages[request.messages.length - 1];
      const lastText = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (delta: Json, finish: string | null = null) =>
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'fake', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      if (last?.role === 'tool') {
        chunk({ role: 'assistant', content: `TOOL_DONE: ${String(last.content).slice(0, 80)}` });
        chunk({}, 'stop');
      } else if (lastText.includes('use bash')) {
        chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: '' } }] });
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":"echo smoke-ok"}' } }] });
        chunk({}, 'tool_calls');
      } else {
        chunk({ role: 'assistant', content: 'pong: ' });
        chunk({ content: lastText.replace(/<stdin>[\s\S]*/, '').trim() });
        chunk({}, 'stop');
      }
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'fake', choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number };
    resolve({ url: `http://127.0.0.1:${port}/v1`, close: () => server.close() });
  }));
}

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 400)}`}`);
  if (!ok) failures.push(name);
}

async function readSse(res: Response, onEvent?: (e: Json) => void | Promise<void>): Promise<Json[]> {
  const events: Json[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        const e = JSON.parse(line.slice(6)) as Json;
        events.push(e);
        await onEvent?.(e);
      }
    }
  }
  return events;
}

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(cwd, 'node_modules/tsx/dist/cli.mjs'), 'scripts/cli.ts', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  const root = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-smoke-'));
  const llm = await fakeLlm();
  const port = 3900 + Math.floor(Math.random() * 90);
  const key = 'smoke-key';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COPHARNESS_MODEL: 'openai/fake-model',
    OPENAI_API_KEY: 'test',
    OPENAI_BASE_URL: llm.url,
    COPHARNESS_DATA_DIR: path.join(tmp, 'data'),
    COPHARNESS_WORKSPACE: path.join(tmp, 'workspace'),
    COPHARNESS_API_KEY: key,
    COPHARNESS_CONFIG: '',
    DISCORD_BOT_TOKEN: '',
    LINE_CHANNEL_SECRET: '',
    SLACK_SIGNING_SECRET: '',
    PORT: String(port),
    NODE_ENV: 'production',
  };
  delete env.ANTHROPIC_API_KEY;
  let server: ChildProcess | undefined;
  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  try {
    server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    server.stdout?.on('data', c => { log += c; });
    server.stderr?.on('data', c => { log += c; });
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await new Promise(r => setTimeout(r, 500));
      up = await fetch(`${base}/api/health`).then(r => r.ok, () => false);
    }
    check('server starts', up, log);
    if (!up) return;

    check('status requires auth', (await fetch(`${base}/api/status`)).status === 401);
    const status = await (await fetch(`${base}/api/status`, { headers: auth })).json() as Json;
    check('status reports model', status.model === 'openai/fake-model', status);
    check('web UI is served', (await fetch(`${base}/`)).status === 200);

    // New session with streaming.
    const first = await fetch(`${base}/api/sessions`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'hello' }) });
    const sessionId = first.headers.get('x-session-id') ?? '';
    const firstEvents = await readSse(first);
    const end = firstEvents.find(e => e.type === 'turn_end') as Json | undefined;
    check('chat turn completes', end?.text === 'pong: hello', firstEvents);

    // Tool call that needs approval, approved through the API.
    const second = await fetch(`${base}/api/sessions/${sessionId}/messages`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'please use bash' }) });
    const secondEvents = await readSse(second, async e => {
      if (e.type === 'permission_request') {
        const id = (e.request as Json).id as string;
        const r = await fetch(`${base}/api/approvals/${id}`, { method: 'POST', headers: auth, body: JSON.stringify({ decision: 'allow' }) });
        check('approval accepted', r.ok);
      }
    });
    const toolResult = secondEvents.find(e => e.type === 'tool_result') as Json | undefined;
    check('approved bash runs', String(toolResult?.content ?? '').includes('smoke-ok'), secondEvents);
    const end2 = secondEvents.find(e => e.type === 'turn_end') as Json | undefined;
    check('tool result returns to the model', String(end2?.text).startsWith('TOOL_DONE'), end2);

    const list = await (await fetch(`${base}/api/sessions`, { headers: auth })).json() as { sessions: Json[] };
    check('session is listed', list.sessions.some(s => s.id === sessionId));
    const detail = await (await fetch(`${base}/api/sessions/${sessionId}`, { headers: auth })).json() as Json;
    check('session detail has the transcript', Array.isArray(detail.messages) && (detail.messages as unknown[]).length === 6, detail.messages);

    // v1 compatibility.
    const compat = await (await fetch(`${base}/api/copilot`, { method: 'POST', headers: auth, body: JSON.stringify({ messages: [{ role: 'user', content: 'compat' }] }) })).json() as Json;
    check('/api/copilot compatibility', compat.reply === 'pong: compat', compat);
    const compatStream = await readSse(await fetch(`${base}/api/copilot/stream`, { method: 'POST', headers: auth, body: JSON.stringify({ messages: [{ role: 'user', content: 'streamed' }] }) }));
    check('/api/copilot/stream compatibility', compatStream.some(e => e.done === true && e.reply === 'pong: streamed'), compatStream);

    // Schedules.
    const sched = await (await fetch(`${base}/api/schedules`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'smoke', cron: '09:00', prompt: 'scheduled' }) })).json() as Json;
    check('schedule created', sched.cron === '0 9 * * *', sched);
    await fetch(`${base}/api/schedules/${sched.id}/run`, { method: 'POST', headers: auth });
    let ran: Json | undefined;
    for (let i = 0; i < 20 && !ran; i++) {
      await new Promise(r => setTimeout(r, 300));
      const all = await (await fetch(`${base}/api/schedules`, { headers: auth })).json() as { schedules: Json[] };
      ran = all.schedules.find(s => s.id === sched.id && s.lastStatus);
    }
    check('schedule runs on demand', ran?.lastStatus === 'end_turn', ran);

    check('LINE webhook without config is unavailable', (await fetch(`${base}/api/line`, { method: 'POST', body: '{}' })).status === 503);
    check('Slack webhook without config is unavailable', (await fetch(`${base}/api/slack`, { method: 'POST', body: '{}' })).status === 503);

    // CLI headless mode shares the data directory.
    const cliEnv: NodeJS.ProcessEnv = { ...env, NODE_ENV: 'development' };
    const cli = await runCli(['-p', 'from cli', '--output', 'json'], cliEnv, root);
    let parsed: Json = {};
    try { parsed = JSON.parse(cli.stdout) as Json; } catch { /* reported below */ }
    check('cli -p answers', parsed.text === 'pong: from cli' && cli.code === 0, cli);
    const denied = await runCli(['-p', 'use bash'], cliEnv, root);
    check('cli -p denies tools that need approval', denied.stdout.startsWith('TOOL_DONE') && denied.stdout.includes('承認'), denied);
    const sessions = await runCli(['sessions'], cliEnv, root);
    check('cli lists sessions', sessions.stdout.includes('from cli'), sessions);
  } finally {
    server?.kill('SIGTERM');
    llm.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(() => {
  if (failures.length) {
    console.error(`\n${failures.length} 件失敗しました`);
    process.exit(1);
  }
  console.log('\nすべてのスモークテストに成功しました');
  process.exit(0);
}, err => {
  console.error(err);
  process.exit(1);
});
