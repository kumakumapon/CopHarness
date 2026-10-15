/** Production HTTP + CLI smoke checks against a local, deterministic OpenAI-compatible server.
 * Run after npm run build. No external provider credentials or calls are used. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-smoke-'));
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
const children = new Set<ChildProcess>();
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const provider = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  requests.push({ url: req.url ?? '', body });
  if (req.url !== '/v1/chat/completions') { res.writeHead(200); res.end('{}'); return; }
  const tools = (body.tools ?? []) as Array<{ function: { name: string } }>;
  const messages = body.messages as Array<{ role: string; content: string }>;
  const hasResult = messages.some(message => message.role === 'tool');
  const control = tools.find(tool => tool.function.name === 'markComplete');
  const calculate = tools.some(tool => tool.function.name === 'calculator') && messages.some(message => message.content?.includes('calculate'));
  const toolName = !hasResult ? control?.function.name ?? (calculate ? 'calculator' : undefined) : undefined;
  if (body.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'smoke reply' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'smoke', model: 'smoke-model', choices: [{ finish_reason: toolName ? 'tool_calls' : 'stop', message: {
      role: 'assistant', content: toolName ? null : calculate ? '5' : 'smoke reply',
      ...(toolName ? { tool_calls: [{ id: 'call_smoke', type: 'function', function: { name: toolName, arguments: JSON.stringify(toolName === 'calculator' ? { expression: '2+3' } : { summary: 'done' }) } }] } : {}),
    } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
  }
});

function launch(args: string[], env: NodeJS.ProcessEnv, cwd = repo) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let output = '';
  child.stdout!.on('data', chunk => { output += chunk; });
  child.stderr!.on('data', chunk => { output += chunk; });
  child.once('exit', () => children.delete(child));
  return { child, output: () => output };
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), pause(3000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); })]);
}

async function waitUntil(check: () => boolean | Promise<boolean>, output: () => string) {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error(`Smoke check timed out:\n${output()}`);
}

async function freePort() {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

async function main() {
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const providerPort = (provider.address() as { port: number }).port;
  const baseEnv = { ...process.env, COPILOT_PROVIDER: 'lmstudio', LMSTUDIO_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
    COPILOT_MODEL: 'smoke-model', COPHARNESS_API_KEY: 'smoke-api', ENABLED_SKILLS: 'calculator', NEXT_TELEMETRY_DISABLED: '1',
    BUDGET_MAX_TOKENS: '', BUDGET_MAX_COST_USD: '', BUDGET_USER_MAX_TOKENS: '', BUDGET_USER_MAX_COST_USD: '', BUDGET_TASK_MAX_TOKENS: '', BUDGET_TASK_MAX_COST_USD: '',
    TRANSCRIPT_LOGGING: 'true', MEMORY_NUDGE_ENABLED: 'true', LLM_CACHE_ENABLED: 'true', RETRY_MAX_RETRIES: '0' };
  for (const profile of ['minimal', 'full']) {
    const dataDir = path.join(temp, `${profile}-data`);
    const port = await freePort();
    const server = launch([path.join(repo, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
      ...baseEnv, COPHARNESS_PROFILE: profile, DATA_DIR: dataDir,
      COMPACTOR_TOKEN_THRESHOLD: profile === 'minimal' ? '1' : '3000',
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${providerPort}/telemetry`,
    });
    const url = `http://127.0.0.1:${port}`;
    await waitUntil(async () => { try { return (await fetch(`${url}/api/health`)).ok; } catch { return false; } }, server.output);
    const post = (route: string, body: unknown, auth = true) => fetch(url + route, { method: 'POST', headers: {
      'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer smoke-api' } : {}),
    }, body: JSON.stringify(body) });
    assert.equal((await post('/api/copilot', {}, false)).status, 401);
    assert.equal((await post('/api/copilot', {})).status, 400);
    const before = requests.length;
    const chat = await post('/api/copilot', { messages: [{ role: 'user', content: 'hello' }], skills: [] });
    assert.equal(chat.status, 200, await chat.clone().text());
    assert.equal((await chat.json()).reply, 'smoke reply');
    if (profile === 'minimal') {
      assert.equal(requests.length - before, 1, 'No automatic summaries or telemetry requests');
      assert.equal(requests.at(-1)!.body.tools, undefined, 'Explicit empty tool selection');
      const calculate = await post('/api/copilot', { messages: [{ role: 'user', content: 'calculate' }] });
      assert.equal((await calculate.json()).reply, '5');
    }
    const stream = await post('/api/copilot/stream', { messages: [{ role: 'user', content: 'hello' }], skills: [] });
    assert.match(await stream.text(), /smoke reply[\s\S]*\[DONE\]/);
    const agent = await post('/api/copilot/agent', { goal: 'finish', maxIterations: 2 });
    assert.match(await agent.text(), /"stopReason":"succeeded"/);
    if (profile === 'minimal') {
      for (const route of ['/api/a2a', '/api/line', '/api/slack', '/api/watchers/events', '/api/dashboard/schedules', '/api/dashboard/skill-proposals']) {
        assert.equal((await post(route, {})).status, 404, route);
      }
      for (const route of ['/dashboard', '/playground', '/tutorials']) assert.equal((await fetch(url + route)).status, 404, route);
      assert.match(await (await fetch(url)).text(), /minimal profile/);
      assert.equal((await fetch(url + '/api/dashboard/approvals', { headers: { Authorization: 'Bearer smoke-api' } })).status, 200);
      assert.equal((await post('/api/copilot/agent', { sessionId: 'old' })).status, 400);
      assert.equal(fs.existsSync(dataDir), false, 'Minimal mode must not create data files');
    } else {
      const status = await fetch(url + '/api/dashboard/skills', { headers: { Authorization: 'Bearer smoke-api' } });
      assert.equal(status.status, 200);
      assert.match(await status.text(), /memorySearch/);
      for (const file of ['identities.json', 'task_ledger.json', 'audit.jsonl', 'budget-usage.json']) assert.equal(fs.existsSync(path.join(dataDir, file)), true, file);
    }
    await stop(server.child);
    console.log(`PASS production HTTP ${profile}: chat, SSE, agent, authentication, routes and storage`);
  }
  const cliDir = path.join(temp, 'cli');
  fs.mkdirSync(cliDir);
  const cliData = path.join(cliDir, 'unused-data');
  fs.writeFileSync(path.join(cliDir, '.env.local'), `COPHARNESS_PROFILE=minimal\nENABLED_SKILLS=calculator\nDATA_DIR=${cliData}\n`);
  const cliEnv: NodeJS.ProcessEnv = { ...baseEnv };
  delete cliEnv.COPHARNESS_PROFILE;
  delete cliEnv.ENABLED_SKILLS;
  delete cliEnv.DATA_DIR;
  for (const script of ['cli.ts', 'agentCli.ts']) {
    const cli = launch([path.join(repo, 'node_modules/tsx/dist/cli.mjs'), path.join(repo, 'scripts', script)], cliEnv, cliDir);
    await waitUntil(() => cli.output().includes('You:'), cli.output);
    cli.child.stdin!.write('hello\n');
    await waitUntil(() => cli.output().includes('Assistant: smoke reply'), cli.output);
    const exited = once(cli.child, 'exit');
    cli.child.stdin!.write('exit\n');
    await Promise.race([exited, pause(5000).then(() => { if (cli.child.exitCode === null) throw new Error(cli.output()); })]);
    assert.equal(cli.child.exitCode, 0, cli.output());
    assert.equal(fs.existsSync(cliData), false, 'CLI must load the profile from .env.local before bootstrap');
    console.log(`PASS ${script}: .env.local profile, real adapter reply and exit without saving`);
  }
  const bot = launch([path.join(repo, 'scripts/run-discord-maybe.js')], { ...baseEnv, COPHARNESS_PROFILE: 'minimal', DISCORD_BOT_TOKEN: 'unused' });
  await once(bot.child, 'exit');
  assert.equal(bot.child.exitCode, 0);
  assert.match(bot.output(), /Disabled in the minimal profile/);
  console.log('PASS Discord startup skipped even with a configured token');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const child of children) await stop(child);
  await new Promise<void>(resolve => provider.close(() => resolve()));
  fs.rmSync(temp, { recursive: true, force: true });
});
