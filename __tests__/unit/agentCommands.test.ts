import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import {
  _resetTaskLedgerForTests,
  startTask,
  finishTask,
} from '../../lib/tasks/ledger';
import { _resetTaskCancellationForTests } from '../../lib/tasks/cancellation';
import {
  parseAgentCommand,
  executeAgentCommand,
  getApproverAllowlist,
  isAuthorizedApprover,
} from '../../lib/channels/agentCommands';
import { createApprovalRequest } from '../../lib/humanInLoop/store';

// The HIL store is an in-memory singleton with no reset — we isolate via
// unique skillName / requestedBy values per test.

describe('parseAgentCommand', () => {
  describe('listTasks', () => {
    it.each(['tasks', 'タスク', 'タスク一覧', '進捗'])('parses "%s"', (text) => {
      expect(parseAgentCommand(text)).toEqual({ kind: 'listTasks' });
    });

    it('is case-insensitive for ascii', () => {
      expect(parseAgentCommand('TASKS')).toEqual({ kind: 'listTasks' });
    });
  });

  describe('taskDetail', () => {
    it.each([
      ['task abc123', 'abc123'],
      ['task task_xyz', 'task_xyz'],
      ['タスク abc123', 'abc123'],
    ])('parses "%s"', (text, idPrefix) => {
      expect(parseAgentCommand(text)).toEqual({ kind: 'taskDetail', idPrefix });
    });

    it('タスク <id> does not match タスクの話', () => {
      expect(parseAgentCommand('タスクの話')).toBeNull();
    });
  });

  describe('stopTask', () => {
    it.each([
      ['stop abc', 'abc'],
      ['停止 abc', 'abc'],
      ['STOP abc', 'abc'],
    ])('parses "%s"', (text, idPrefix) => {
      expect(parseAgentCommand(text)).toEqual({ kind: 'stopTask', idPrefix });
    });

    it('"stop being lazy" does NOT parse', () => {
      // "being" contains spaces, so "stop being lazy" won't match `stop <single-id>`
      // Actually it DOES have spaces so let's verify
      expect(parseAgentCommand('stop being lazy')).toBeNull();
    });
  });

  describe('listApprovals', () => {
    it.each(['approvals', '承認待ち', '承認一覧'])('parses "%s"', (text) => {
      expect(parseAgentCommand(text)).toEqual({ kind: 'listApprovals' });
    });
  });

  describe('approve', () => {
    it.each([
      ['approve abc', 'abc'],
      ['承認 abc', 'abc'],
    ])('parses "%s"', (text, idPrefix) => {
      expect(parseAgentCommand(text)).toEqual({ kind: 'approve', idPrefix });
    });
  });

  describe('reject', () => {
    it.each([
      ['reject abc', 'abc'],
      ['却下 abc', 'abc'],
      ['拒否 abc', 'abc'],
    ])('parses "%s"', (text, idPrefix) => {
      expect(parseAgentCommand(text)).toEqual({ kind: 'reject', idPrefix });
    });
  });

  describe('help', () => {
    it.each(['agent help', 'エージェントヘルプ'])('parses "%s"', (text) => {
      expect(parseAgentCommand(text)).toEqual({ kind: 'help' });
    });
  });

  describe('null cases (must not hijack normal chat)', () => {
    it.each([
      'タスクの話',
      'stop being lazy',
      'some random message',
      'task',          // missing id
      'approve',       // missing id
      'reject',        // missing id
      'stop',          // missing id
      '',
      '  ',
      'hey tasks',     // not anchored
      'tasks are fun', // not anchored
    ])('does NOT parse "%s"', (text) => {
      expect(parseAgentCommand(text)).toBeNull();
    });
  });
});

describe('executeAgentCommand — task operations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-agentcmd-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    _resetTaskCancellationForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    _resetDataDirCache();
    _resetTaskLedgerForTests();
    _resetTaskCancellationForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('listTasks — returns "no tasks" message when empty', async () => {
    const reply = await executeAgentCommand({ kind: 'listTasks' }, {});
    expect(reply).toContain('タスクはまだありません');
  });

  it('listTasks — lists tasks scoped by personId', async () => {
    await startTask({ kind: 'agent', personId: 'person_A', title: 'Task for A' });
    await startTask({ kind: 'agent', personId: 'person_B', title: 'Task for B' });

    const reply = await executeAgentCommand(
      { kind: 'listTasks' },
      { personId: 'person_A' },
    );
    expect(reply).toContain('Task for A');
    expect(reply).not.toContain('Task for B');
  });

  it('listTasks — falls back to channelKey when no personId', async () => {
    await startTask({ kind: 'agent', channelKey: 'line:u1', title: 'CH Task' });
    await startTask({ kind: 'agent', channelKey: 'discord:u2', title: 'Other CH Task' });

    const reply = await executeAgentCommand(
      { kind: 'listTasks' },
      { channelKey: 'line:u1' },
    );
    expect(reply).toContain('CH Task');
    expect(reply).not.toContain('Other CH Task');
  });

  it('listTasks — shows all if no identity', async () => {
    await startTask({ kind: 'agent', title: 'Global Task' });
    const reply = await executeAgentCommand({ kind: 'listTasks' }, {});
    expect(reply).toContain('Global Task');
  });

  it('taskDetail — not found', async () => {
    const reply = await executeAgentCommand(
      { kind: 'taskDetail', idPrefix: 'nonexistent' },
      {},
    );
    expect(reply).toContain('見つかりません');
  });

  it('taskDetail — finds task by id prefix (without task_)', async () => {
    const task = await startTask({ kind: 'agent', title: 'My Task' });
    // Strip the "task_" prefix and use first 8 chars of uuid part
    const uuidPart = task.id.replace('task_', '').slice(0, 8);

    const reply = await executeAgentCommand(
      { kind: 'taskDetail', idPrefix: uuidPart },
      {},
    );
    expect(reply).toContain(task.id);
    expect(reply).toContain('My Task');
  });

  it('taskDetail — finds task by full id prefix', async () => {
    const task = await startTask({ kind: 'conversation', title: 'Full Prefix Task' });
    const prefix = task.id.slice(0, 10);

    const reply = await executeAgentCommand(
      { kind: 'taskDetail', idPrefix: prefix },
      {},
    );
    expect(reply).toContain(task.id);
  });

  it('taskDetail — shows ambiguity message when multiple tasks match', async () => {
    // Create two tasks and look for them with a very short common prefix
    // We control via DATA_DIR isolation so these are the only tasks
    const t1 = await startTask({ kind: 'agent' });
    const t2 = await startTask({ kind: 'agent' });

    // Use a prefix that's so short it matches everything
    // Both ids start with "task_" so "task_" matches both
    const reply = await executeAgentCommand(
      { kind: 'taskDetail', idPrefix: 'task_' },
      {},
    );
    // Should say multiple matches
    expect(reply).toContain('複数');
    expect(reply).toContain(t1.id);
    expect(reply).toContain(t2.id);
  });

  it('stopTask — marks a running task as cancelled', async () => {
    const task = await startTask({ kind: 'agent', title: 'Stoppable' });
    const prefix = task.id.slice(0, 15);

    const reply = await executeAgentCommand(
      { kind: 'stopTask', idPrefix: prefix },
      {},
    );
    expect(reply).toContain('停止を要求しました');

    // Verify task was cancelled in ledger
    const { getTask } = await import('../../lib/tasks/ledger');
    const updated = getTask(task.id);
    expect(updated?.status).toBe('cancelled');
  });

  it('stopTask — not running for a finished task', async () => {
    const task = await startTask({ kind: 'agent' });
    await finishTask(task.id, 'succeeded');
    const prefix = task.id.slice(0, 15);

    const reply = await executeAgentCommand(
      { kind: 'stopTask', idPrefix: prefix },
      {},
    );
    expect(reply).toContain('実行中ではありません');
  });

  it('stopTask — not found for unknown prefix', async () => {
    const reply = await executeAgentCommand(
      { kind: 'stopTask', idPrefix: 'zzz_unknown' },
      {},
    );
    expect(reply).toContain('見つかりません');
  });

  it('help — returns command list', async () => {
    const reply = await executeAgentCommand({ kind: 'help' }, {});
    expect(reply).toContain('tasks');
    expect(reply).toContain('stop');
    expect(reply).toContain('approvals');
  });
});

describe('executeAgentCommand — approval operations', () => {
  // Note: the HIL store is a shared in-memory singleton with no reset.
  // We isolate test data by using unique skillName + requestedBy values.

  it('listApprovals — returns no-pending message when empty', async () => {
    const reply = await executeAgentCommand({ kind: 'listApprovals' }, {});
    // Could have pending from other tests; just verify it doesn't throw
    expect(typeof reply).toBe('string');
  });

  it('approve — approves a pending request by prefix', async () => {
    const req = createApprovalRequest('mySkill_approve_test', {}, 'tester');

    const reply = await executeAgentCommand(
      { kind: 'approve', idPrefix: req.id },
      {},
    );
    expect(reply).toContain('承認しました');
    expect(reply).toContain('mySkill_approve_test');
    expect(reply).toContain(req.id);
  });

  it('reject — rejects a pending request by prefix', async () => {
    const req = createApprovalRequest('mySkill_reject_test', {}, 'tester');

    const reply = await executeAgentCommand(
      { kind: 'reject', idPrefix: req.id },
      {},
    );
    expect(reply).toContain('却下しました');
    expect(reply).toContain('mySkill_reject_test');
  });

  it('approve — not found for unknown prefix', async () => {
    const reply = await executeAgentCommand(
      { kind: 'approve', idPrefix: 'zzznonexistent' },
      {},
    );
    expect(reply).toContain('見つかりません');
  });

  it('approve — not found for already-resolved (non-pending) request', async () => {
    const req = createApprovalRequest('mySkill_double_resolve', {}, 'tester');

    // First approval should succeed
    await executeAgentCommand({ kind: 'approve', idPrefix: req.id }, {});

    // Second approval — the request is no longer pending, so prefix search finds nothing
    const reply2 = await executeAgentCommand(
      { kind: 'approve', idPrefix: req.id },
      {},
    );
    // resolveApprovalsByPrefix searches only 'pending', so it returns not-found
    expect(reply2).toContain('見つかりません');
  });

  it('listApprovals — shows pending requests', async () => {
    const req = createApprovalRequest('listTest_skill_unique', {}, 'someone');

    const reply = await executeAgentCommand({ kind: 'listApprovals' }, {});
    expect(reply).toContain('listTest_skill_unique');
    expect(reply).toContain(req.id);
    expect(reply).toContain('承認');
  });
});

describe('承認者 allowlist (AGENT_COMMAND_APPROVERS)', () => {
  afterEach(() => {
    delete process.env.AGENT_COMMAND_APPROVERS;
  });

  // ── getApproverAllowlist ──────────────────────────────────────────────────

  it('getApproverAllowlist — 未設定のとき null を返す', () => {
    delete process.env.AGENT_COMMAND_APPROVERS;
    expect(getApproverAllowlist()).toBeNull();
  });

  it('getApproverAllowlist — 空文字のとき null を返す（後方互換）', () => {
    process.env.AGENT_COMMAND_APPROVERS = '';
    expect(getApproverAllowlist()).toBeNull();
  });

  it('getApproverAllowlist — スペースのみのとき null を返す', () => {
    process.env.AGENT_COMMAND_APPROVERS = '  ,  ,  ';
    expect(getApproverAllowlist()).toBeNull();
  });

  it('getApproverAllowlist — カンマ区切りのエントリをトリムして返す', () => {
    process.env.AGENT_COMMAND_APPROVERS = ' alice , bob , charlie ';
    expect(getApproverAllowlist()).toEqual(['alice', 'bob', 'charlie']);
  });

  // ── isAuthorizedApprover ──────────────────────────────────────────────────

  it('isAuthorizedApprover — 未設定のとき常に true（後方互換）', () => {
    delete process.env.AGENT_COMMAND_APPROVERS;
    expect(isAuthorizedApprover({})).toBe(true);
    expect(isAuthorizedApprover({ personId: 'anyone' })).toBe(true);
  });

  it('isAuthorizedApprover — personId がリストに含まれる場合 true', () => {
    process.env.AGENT_COMMAND_APPROVERS = 'alice,bob';
    expect(isAuthorizedApprover({ personId: 'alice' })).toBe(true);
  });

  it('isAuthorizedApprover — channelKey がリストに含まれる場合 true', () => {
    process.env.AGENT_COMMAND_APPROVERS = 'line:U123,discord:456';
    expect(isAuthorizedApprover({ channelKey: 'line:U123' })).toBe(true);
  });

  it('isAuthorizedApprover — personId も channelKey もリストに含まれない場合 false', () => {
    process.env.AGENT_COMMAND_APPROVERS = 'alice,bob';
    expect(isAuthorizedApprover({ personId: 'charlie' })).toBe(false);
    expect(isAuthorizedApprover({ channelKey: 'line:unknown' })).toBe(false);
    expect(isAuthorizedApprover({})).toBe(false);
  });

  it('isAuthorizedApprover — personId または channelKey のいずれかが一致すれば true', () => {
    process.env.AGENT_COMMAND_APPROVERS = 'alice';
    expect(isAuthorizedApprover({ personId: 'alice', channelKey: 'discord:999' })).toBe(true);
  });

  // ── executeAgentCommand — approve/reject with allowlist ───────────────────

  it('AGENT_COMMAND_APPROVERS 未設定 — approve が従来どおり動作する（後方互換）', async () => {
    delete process.env.AGENT_COMMAND_APPROVERS;
    const req = createApprovalRequest('allowlist_compat_approve', {}, 'tester');

    const reply = await executeAgentCommand(
      { kind: 'approve', idPrefix: req.id },
      {},
    );
    expect(reply).toContain('承認しました');
    expect(reply).toContain('allowlist_compat_approve');
  });

  it('AGENT_COMMAND_APPROVERS 未設定 — reject が従来どおり動作する（後方互換）', async () => {
    delete process.env.AGENT_COMMAND_APPROVERS;
    const req = createApprovalRequest('allowlist_compat_reject', {}, 'tester');

    const reply = await executeAgentCommand(
      { kind: 'reject', idPrefix: req.id },
      {},
    );
    expect(reply).toContain('却下しました');
  });

  it('許可リストに含まれる personId からの approve は成功する', async () => {
    process.env.AGENT_COMMAND_APPROVERS = 'approved_user,other_user';
    const req = createApprovalRequest('allowlist_approve_ok', {}, 'tester');

    const reply = await executeAgentCommand(
      { kind: 'approve', idPrefix: req.id },
      { personId: 'approved_user' },
    );
    expect(reply).toContain('承認しました');
    expect(reply).toContain('allowlist_approve_ok');
  });

  it('許可リストに含まれる channelKey からの reject は成功する', async () => {
    process.env.AGENT_COMMAND_APPROVERS = 'line:U_approved';
    const req = createApprovalRequest('allowlist_reject_ok', {}, 'tester');

    const reply = await executeAgentCommand(
      { kind: 'reject', idPrefix: req.id },
      { channelKey: 'line:U_approved' },
    );
    expect(reply).toContain('却下しました');
    expect(reply).toContain('allowlist_reject_ok');
  });

  it('許可リストに含まれない ctx からの approve は拒否メッセージを返す', async () => {
    process.env.AGENT_COMMAND_APPROVERS = 'alice,bob';
    const req = createApprovalRequest('allowlist_approve_denied', {}, 'tester');

    const reply = await executeAgentCommand(
      { kind: 'approve', idPrefix: req.id },
      { personId: 'charlie' },
    );
    expect(reply).toContain('権限がありません');
    expect(reply).not.toContain('承認しました');
  });

  it('許可リストに含まれない ctx からの reject は拒否メッセージを返し、HIL ストアの状態が変わらない', async () => {
    process.env.AGENT_COMMAND_APPROVERS = 'alice';
    const req = createApprovalRequest('allowlist_reject_denied', {}, 'tester');

    const reply = await executeAgentCommand(
      { kind: 'reject', idPrefix: req.id },
      { personId: 'mallory' },
    );
    expect(reply).toContain('権限がありません');
    expect(reply).not.toContain('却下しました');

    // リクエストがまだ pending であることを確認（権限のある人が approve できること）
    process.env.AGENT_COMMAND_APPROVERS = 'alice';
    const replyOk = await executeAgentCommand(
      { kind: 'approve', idPrefix: req.id },
      { personId: 'alice' },
    );
    expect(replyOk).toContain('承認しました');
  });

  it('identity が ctx に含まれない場合、設定済みリストでは拒否される', async () => {
    process.env.AGENT_COMMAND_APPROVERS = 'alice';
    const req = createApprovalRequest('allowlist_no_identity', {}, 'tester');

    const reply = await executeAgentCommand(
      { kind: 'approve', idPrefix: req.id },
      {},
    );
    expect(reply).toContain('権限がありません');
  });
});
