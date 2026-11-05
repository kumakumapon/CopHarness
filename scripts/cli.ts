/**
 * CopHarness CLI — one command for interactive chat, headless runs and admin tasks.
 *
 *   npm run cli                       対話モード
 *   npm run cli -- "質問"              最初のメッセージを送って対話モード
 *   npm run cli -- -p "質問"           1回だけ実行して結果を出力（ヘッドレス）
 *   npm run cli -- -c | -r <id>        前回の会話を続ける / 指定した会話を再開
 *   npm run cli -- sessions | doctor | token | schedule ...
 */
import '../lib/env';
import * as readline from 'node:readline';
import { parseArgs } from 'node:util';
import { getLoadedConfig, PERMISSION_MODES, type PermissionMode } from '../lib/config';
import { c, formatTodos, formatToolCall, formatToolResult, formatUsage, oneLine, STOP_LABELS } from '../lib/cli/format';
import { runDoctor } from '../lib/doctor';
import { listProviderStatus } from '../lib/providers';
import { getRuntime, type Runtime } from '../lib/runtime';
import { describeNextRun, getScheduler } from '../lib/scheduler';
import { getAccessToken, webUrl } from '../lib/server/auth';
import type { DeliveryTarget } from '../lib/channels/notify';
import type { AgentEvent, PermissionDecision, PermissionRequest } from '../lib/types';

const HELP = `
${c.bold('CopHarness CLI')}

使い方:
  npm run cli                         対話モード
  npm run cli -- "質問"                最初のメッセージを送って対話モードへ
  npm run cli -- -p "質問"             1回だけ実行して結果を出力（ヘッドレス）
  npm run cli -- -c                    前回の会話を続ける
  npm run cli -- -r <id>               指定した会話を再開
  npm run cli -- sessions              保存された会話の一覧
  npm run cli -- doctor                設定の診断
  npm run cli -- token                 Web UI を開く URL（アクセストークン付き）
  npm run cli -- schedule <list|add|rm|enable|disable|run> ...

オプション:
  -m, --model <provider/model>        例: anthropic/claude-opus-5-5, openai/gpt-5-mini, lmstudio/qwen3
      --mode <mode>                   default | acceptEdits | readonly | bypass
      --output <text|json|stream-json>  -p の出力形式（既定 text）
  -h, --help
`;

const SLASH_HELP = `
  /new                 新しい会話を始める
  /sessions            会話の一覧
  /resume <id>         会話を再開
  /model [ref]         モデルを表示・変更（例: /model openai/gpt-5）
  /mode [mode]         権限モードを表示・変更（default / acceptEdits / readonly / bypass）
  /tools               使えるツール
  /mcp                 MCP サーバーの状態
  /skills              スキル一覧
  /todos               作業リスト
  /cost                この会話と本日の使用量
  /compact             会話を要約して圧縮
  /status              設定の診断
  /exit                終了（Ctrl+D でも可）
  行末を \\ にすると改行して続けて入力できます。実行中の Ctrl+C で中断します。
`;

function parse() {
  return parseArgs({
    allowPositionals: true,
    options: {
      print: { type: 'string', short: 'p' },
      continue: { type: 'boolean', short: 'c' },
      resume: { type: 'string', short: 'r' },
      model: { type: 'string', short: 'm' },
      mode: { type: 'string' },
      output: { type: 'string' },
      name: { type: 'string' },
      deliver: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
}

function parseMode(value: string | undefined): PermissionMode | undefined {
  if (!value) return undefined;
  if (!PERMISSION_MODES.includes(value as PermissionMode)) throw new Error(`--mode は ${PERMISSION_MODES.join(' / ')} のいずれかです`);
  return value as PermissionMode;
}

function parseDeliver(value: string | undefined): DeliveryTarget | undefined {
  if (!value) return undefined;
  const i = value.indexOf(':');
  const channel = value.slice(0, i) as DeliveryTarget['channel'];
  const to = value.slice(i + 1);
  if (i < 0 || !['discord', 'line', 'slack', 'webhook'].includes(channel) || !to) {
    throw new Error('--deliver は discord:<チャンネルID> / line:<ユーザーID> / slack:<チャンネルID> / webhook:<URL> の形式です');
  }
  return { channel, to } as DeliveryTarget;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------
// Headless
// ---------------------------------------------------------------------------

async function headless(runtime: Runtime, prompt: string, opts: { model?: string; mode?: PermissionMode; output: string; sessionId?: string }) {
  const piped = await readStdin();
  const text = piped.trim() ? `${prompt}\n\n<stdin>\n${piped.trim()}\n</stdin>` : prompt;
  const onEvent = opts.output === 'stream-json' ? (e: AgentEvent) => process.stdout.write(JSON.stringify(e) + '\n') : undefined;
  let sessionId = opts.sessionId;
  let result;
  if (sessionId) {
    if (opts.model) await runtime.setModel(sessionId, opts.model);
    if (opts.mode) await runtime.setPermissionMode(sessionId, opts.mode);
    result = await runtime.send(sessionId, text, { interactive: false, onEvent });
  } else {
    const started = await runtime.start(text, { owner: 'local', model: opts.model, permissionMode: opts.mode, interactive: false, onEvent, title: prompt });
    sessionId = started.sessionId;
    result = await started.result;
  }
  if (opts.output === 'json') {
    process.stdout.write(JSON.stringify({ sessionId, ...result }, null, 2) + '\n');
  } else if (opts.output === 'text') {
    process.stdout.write(result.text + (result.text.endsWith('\n') ? '' : '\n'));
    if (result.stopReason !== 'end_turn') process.stderr.write(`[${STOP_LABELS[result.stopReason]}${result.error ? `: ${result.error}` : ''}]\n`);
  }
  return result.stopReason === 'end_turn' ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Interactive
// ---------------------------------------------------------------------------

async function interactive(runtime: Runtime, opts: { firstPrompt?: string; sessionId?: string; model?: string; mode?: PermissionMode }) {
  const config = runtime.config;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
    completer: (line: string) => {
      const cmds = ['/new', '/sessions', '/resume', '/model', '/mode', '/tools', '/mcp', '/skills', '/todos', '/cost', '/compact', '/status', '/help', '/exit'];
      return [cmds.filter(x => x.startsWith(line)), line];
    },
  });
  let closed = false;
  rl.on('close', () => { closed = true; });

  const question = (prompt: string) => new Promise<string | null>(resolve => {
    if (closed) return resolve(null);
    const onClose = () => resolve(null);
    rl.once('close', onClose);
    rl.question(prompt, answer => { rl.off('close', onClose); resolve(answer); });
  });

  let sessionId = opts.sessionId;
  let model = opts.model;
  let mode = opts.mode;
  let running = false;
  let interruptedOnce = false;

  rl.on('SIGINT', () => {
    if (running && sessionId) {
      runtime.cancel(sessionId);
      process.stdout.write(c.yellow('\n中断しています…\n'));
      return;
    }
    if (rl.line) {
      // Clear the current line.
      (rl as unknown as { line: string }).line = '';
      process.stdout.write('\n');
      rl.prompt();
      return;
    }
    if (interruptedOnce) rl.close();
    else {
      interruptedOnce = true;
      process.stdout.write(c.gray('\n（もう一度 Ctrl+C で終了）\n'));
      rl.prompt();
    }
  });

  // Approvals are asked one at a time.
  let approvalChain = Promise.resolve();
  const askApproval = (req: PermissionRequest) => {
    approvalChain = approvalChain.then(async () => {
      process.stdout.write(`\n${c.yellow('?')} ${c.bold(req.tool)} を実行しますか？ ${c.gray(req.reason)}\n  ${oneLine(req.summary, 300)}\n`);
      const answer = (await question(`  ${c.bold('[y]')} 許可  ${c.bold('[a]')} この会話では常に許可  ${c.bold('[n]')} 拒否 › `))?.trim().toLowerCase();
      const decision: PermissionDecision = answer === 'y' || answer === 'yes' ? 'allow' : answer === 'a' || answer === 'always' ? 'allow_always' : 'deny';
      runtime.resolveApproval(req.id, decision, 'cli');
    });
  };

  let atLineStart = true;
  const write = (s: string) => { process.stdout.write(s); atLineStart = s.endsWith('\n'); };
  const line = (s: string) => { if (!atLineStart) write('\n'); write(`${s}\n`); };

  const onEvent = (e: AgentEvent) => {
    switch (e.type) {
      case 'text_delta': if (!e.agent) write(e.text); break;
      case 'tool_call': line(formatToolCall(e.name, e.summary, e.agent)); break;
      case 'tool_result': line(formatToolResult(e.content, e.isError, e.durationMs, e.agent)); break;
      case 'permission_request': askApproval(e.request); break;
      case 'permission_resolved': if (e.by === 'timeout') line(c.yellow('  承認待ちがタイムアウトしたため拒否しました')); break;
      case 'todos': line(formatTodos(e.todos)); break;
      case 'compaction': line(c.gray(`  会話を圧縮しました（約 ${e.beforeTokens.toLocaleString()} → ${e.afterTokens.toLocaleString()} tokens）`)); break;
      case 'notice': line(c.yellow(`  ${e.message}`)); break;
      case 'turn_end': {
        const status = e.stopReason === 'end_turn' ? '' : `${c.yellow(STOP_LABELS[e.stopReason])} · `;
        line(c.gray(`  ${status}${formatUsage(e.usage, e.costUsd)}`));
        break;
      }
    }
  };

  const send = async (text: string) => {
    running = true;
    interruptedOnce = false;
    write('\n');
    try {
      if (!sessionId) {
        const started = await runtime.start(text, { owner: 'local', model, permissionMode: mode, onEvent });
        sessionId = started.sessionId;
        await started.result;
      } else {
        await runtime.send(sessionId, text, { onEvent });
      }
    } catch (err) {
      line(c.red(`エラー: ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      running = false;
      await approvalChain;
      write('\n');
    }
  };

  const banner = async () => {
    const tools = await runtime.tools();
    const mcp = runtime.mcp.status();
    const current = sessionId ? runtime.getSession(sessionId) : undefined;
    console.log(`${c.bold('CopHarness')} ${c.gray('·')} ${current?.model ?? model ?? config.model} ${c.gray('·')} ${current?.permissionMode ?? mode ?? config.permissions.mode} モード`);
    console.log(c.gray(`ワークスペース ${config.workspace} · ツール ${tools.length}${mcp.length ? ` · MCP ${mcp.filter(s => s.state === 'connected').length}/${mcp.length}` : ''}`));
    for (const s of mcp.filter(s => s.state === 'failed')) console.log(c.yellow(`MCP ${s.name} に接続できません: ${s.error}`));
    if (current) {
      console.log(c.gray(`会話「${current.title}」を再開（${current.messages.length} 件）`));
      const lastAssistant = [...current.messages].reverse().find(m => 'role' in m && m.role === 'assistant' && m.content.some(p => p.type === 'text'));
      if (lastAssistant && 'role' in lastAssistant) {
        const t = lastAssistant.content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('');
        console.log(c.gray(`前回の応答: ${oneLine(t, 200)}`));
      }
    }
    console.log(c.gray('/help でコマンド一覧 · Ctrl+C で中断 · Ctrl+D で終了\n'));
  };

  const command = async (input: string): Promise<boolean> => {
    const [cmd, ...rest] = input.slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (cmd) {
      case 'help': console.log(SLASH_HELP); break;
      case 'exit': case 'quit': return false;
      case 'new': sessionId = undefined; console.log(c.gray('新しい会話を始めます。')); break;
      case 'sessions': printSessions(runtime, 20); break;
      case 'resume': {
        const target = arg || runtime.latestSession('local');
        const found = target ? runtime.listSessions().find(s => s.id === target || s.id.endsWith(target)) : undefined;
        if (!found) { console.log(c.red('会話が見つかりません。/sessions で確認してください。')); break; }
        sessionId = found.id;
        await banner();
        break;
      }
      case 'model': {
        if (!arg) {
          console.log(`現在のモデル: ${c.bold(sessionId ? runtime.getSession(sessionId)?.model ?? '' : model ?? config.model)}`);
          const ready = listProviderStatus(config).filter(p => p.configured).map(p => p.name);
          console.log(c.gray(`使えるプロバイダ: ${ready.join(', ')}（例: /model anthropic/claude-sonnet-5-5）`));
          break;
        }
        if (sessionId) await runtime.setModel(sessionId, arg); else model = arg;
        console.log(`モデルを ${c.bold(arg)} に変更しました。`);
        break;
      }
      case 'mode': {
        if (!arg) { console.log(`現在のモード: ${c.bold(sessionId ? runtime.getSession(sessionId)?.permissionMode ?? '' : mode ?? config.permissions.mode)}（${PERMISSION_MODES.join(' / ')}）`); break; }
        const next = parseMode(arg)!;
        if (sessionId) await runtime.setPermissionMode(sessionId, next); else mode = next;
        console.log(`権限モードを ${c.bold(next)} にしました。`);
        break;
      }
      case 'tools': for (const t of await runtime.tools()) console.log(`  ${c.bold(t.name.padEnd(28))} ${c.gray(t.access.padEnd(8))} ${oneLine(t.description, 70)}`); break;
      case 'mcp': {
        const st = runtime.mcp.status();
        if (!st.length) console.log(c.gray('MCP サーバーは設定されていません（copharness.json の mcpServers）。'));
        for (const s of st) console.log(`  ${c.bold(s.name)} ${s.state === 'connected' ? c.green(s.state) : c.red(s.state)} ${c.gray(s.error ?? `${s.tools.length} ツール`)}`);
        break;
      }
      case 'skills': {
        const skills = runtime.skills();
        if (!skills.length) console.log(c.gray('スキルはありません（skills/<名前>/SKILL.md を置くと使えます）。'));
        for (const s of skills) console.log(`  ${c.bold(s.name)} ${c.gray(s.description)}`);
        break;
      }
      case 'todos': {
        const todos = sessionId ? runtime.getSession(sessionId)?.todos ?? [] : [];
        console.log(todos.length ? formatTodos(todos) : c.gray('作業リストはありません。'));
        break;
      }
      case 'cost': {
        const s = sessionId ? runtime.getSession(sessionId) : undefined;
        if (s) console.log(`この会話: ${formatUsage(s.usage, s.costUsd)}${s.contextTokens ? c.gray(` · コンテキスト約 ${s.contextTokens.toLocaleString()} tokens`) : ''}`);
        const day = runtime.usage.today();
        console.log(`本日: ${formatUsage(day.usage, day.costUsd)}`);
        break;
      }
      case 'compact': {
        if (!sessionId) { console.log(c.gray('圧縮する会話がありません。')); break; }
        const r = await runtime.compact(sessionId);
        console.log(c.gray(`圧縮しました（約 ${r.beforeTokens.toLocaleString()} → ${r.afterTokens.toLocaleString()} tokens）`));
        break;
      }
      case 'status': await printDoctor(runtime); break;
      default: console.log(c.red(`不明なコマンドです: /${cmd}（/help で一覧）`));
    }
    return true;
  };

  await banner();
  if (opts.firstPrompt) await send(opts.firstPrompt);

  const buffer: string[] = [];
  while (!closed) {
    const input = await question(buffer.length ? c.gray('… ') : c.bold('› '));
    if (input === null) break;
    if (input.endsWith('\\')) { buffer.push(input.slice(0, -1)); continue; }
    const text = [...buffer, input].join('\n').trim();
    buffer.length = 0;
    if (!text) continue;
    interruptedOnce = false;
    if (text.startsWith('/')) {
      try {
        if (!(await command(text))) break;
      } catch (err) {
        console.log(c.red(err instanceof Error ? err.message : String(err)));
      }
      continue;
    }
    await send(text);
  }
  rl.close();
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function printSessions(runtime: Runtime, limit = 50) {
  const sessions = runtime.listSessions().slice(0, limit);
  if (!sessions.length) return console.log(c.gray('保存された会話はありません。'));
  for (const s of sessions) {
    const when = new Date(s.updatedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    console.log(`  ${c.gray(s.id)} ${c.gray(when)} ${s.owner !== 'local' ? c.blue(`[${s.owner}] `) : ''}${s.title}`);
  }
}

async function printDoctor(runtime: Runtime) {
  const checks = await runDoctor(runtime);
  for (const ch of checks) {
    const icon = ch.level === 'ok' ? c.green('✓') : ch.level === 'warn' ? c.yellow('!') : c.red('✗');
    console.log(`${icon} ${ch.label}${ch.detail ? c.gray(` — ${ch.detail}`) : ''}`);
  }
  return checks.some(ch => ch.level === 'error') ? 1 : 0;
}

async function schedule(runtime: Runtime, args: string[], values: { name?: string; deliver?: string; model?: string }) {
  const scheduler = getScheduler(runtime);
  const store = scheduler.store;
  const [sub, ...rest] = args;
  const need = (id: string | undefined) => {
    const s = id ? store.find(id) : undefined;
    if (!s) throw new Error(`スケジュールが見つかりません: ${id ?? ''}`);
    return s;
  };
  switch (sub) {
    case undefined:
    case 'list': {
      const all = store.list();
      if (!all.length) console.log(c.gray('スケジュールはありません。例: npm run cli -- schedule add "0 9 * * *" "今日の予定を要約して" --name 朝の確認'));
      for (const s of all) {
        const next = s.enabled ? describeNextRun(s) : undefined;
        console.log(`  ${c.gray(s.id)} ${s.enabled ? c.green('on ') : c.gray('off')} ${c.bold(s.name)} ${c.gray(`[${s.cron}]`)}${s.deliver ? c.blue(` → ${s.deliver.channel}`) : ''}`);
        console.log(c.gray(`      ${oneLine(s.prompt, 80)}${next ? ` · 次回 ${new Date(next).toLocaleString('ja-JP')}` : ''}${s.lastStatus ? ` · 前回 ${s.lastStatus}` : ''}`));
      }
      return 0;
    }
    case 'add': {
      const [cron, ...words] = rest;
      const s = store.add({ cron: cron ?? '', prompt: words.join(' '), name: values.name, deliver: parseDeliver(values.deliver), model: values.model });
      console.log(`追加しました: ${s.id} ${s.name} [${s.cron}]`);
      console.log(c.gray('スケジュールはサーバー（npm run dev / npm start）の起動中に実行されます。'));
      return 0;
    }
    case 'rm': case 'remove': { const s = need(rest[0]); store.remove(s.id); console.log(`削除しました: ${s.name}`); return 0; }
    case 'enable': case 'disable': { const s = need(rest[0]); store.update(s.id, { enabled: sub === 'enable' }); console.log(`${sub === 'enable' ? '有効' : '無効'}にしました: ${s.name}`); return 0; }
    case 'run': {
      const s = need(rest[0]);
      console.log(c.gray(`「${s.name}」を実行しています…`));
      const updated = await scheduler.run(s.id);
      console.log(`${updated.lastStatus === 'end_turn' ? c.green('完了') : c.yellow(updated.lastStatus ?? '')} セッション ${updated.lastSessionId ?? '-'}${updated.lastError ? c.red(` ${updated.lastError}`) : ''}`);
      return updated.lastStatus === 'end_turn' ? 0 : 1;
    }
    default:
      throw new Error('schedule のサブコマンドは list / add / rm / enable / disable / run です');
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const { values, positionals } = parse();
  if (values.help) { console.log(HELP); return 0; }
  const loaded = getLoadedConfig();
  for (const w of loaded.warnings) console.error(c.yellow(`! ${w}`));
  const runtime = getRuntime();
  const mode = parseMode(values.mode);
  try {
    const [first, ...rest] = positionals;
    switch (first) {
      case 'doctor': return await printDoctor(runtime);
      case 'sessions': printSessions(runtime); return 0;
      case 'token': {
        const { token, source } = getAccessToken(runtime.config.dataDir);
        console.log(webUrl(token));
        console.log(c.gray(source === 'env' ? 'COPHARNESS_API_KEY を使用しています。' : 'API 呼び出しでは Authorization: Bearer <トークン> を付けてください。'));
        return 0;
      }
      case 'schedule': return await schedule(runtime, rest, values);
    }
    let sessionId: string | undefined;
    if (values.resume) {
      const found = runtime.listSessions().find(s => s.id === values.resume || s.id.endsWith(values.resume!));
      if (!found) throw new Error(`会話が見つかりません: ${values.resume}`);
      sessionId = found.id;
    } else if (values.continue) {
      sessionId = runtime.latestSession('local');
      if (!sessionId) throw new Error('続きから再開できる会話がありません。');
    }
    if (values.print !== undefined) {
      const output = values.output ?? 'text';
      if (!['text', 'json', 'stream-json'].includes(output)) throw new Error('--output は text / json / stream-json のいずれかです');
      const prompt = [values.print, ...positionals].filter(Boolean).join(' ');
      if (!prompt.trim()) throw new Error('-p にプロンプトを指定してください');
      return await headless(runtime, prompt, { model: values.model, mode, output, sessionId });
    }
    if (sessionId && (values.model || mode)) {
      if (values.model) await runtime.setModel(sessionId, values.model);
      if (mode) await runtime.setPermissionMode(sessionId, mode);
    }
    await interactive(runtime, { firstPrompt: positionals.join(' ') || undefined, sessionId, model: values.model, mode });
    return 0;
  } finally {
    await runtime.close();
  }
}

main().then(code => process.exit(code), err => {
  console.error(c.red(err instanceof Error ? err.message : String(err)));
  process.exit(2);
});
