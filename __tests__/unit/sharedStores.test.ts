import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createSharedJsonStore } from '../../lib/utils/sharedJsonStore';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import { getPerson, listChannelIdentities, resolveIdentity, _resetIdentityStoreForTests } from '../../lib/identity/store';
import { getTask, startTask, _resetTaskLedgerForTests } from '../../lib/tasks/ledger';
import { createSkillProposal, listSkillProposals, _resetSkillProposalsForTests } from '../../lib/skillProposals/store';
import { listViolations, recordViolation } from '../../lib/guardrails/violationLog';

describe('sharedJsonStore', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-shared-'));
    file = path.join(dir, 'state.json');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const makeStore = () =>
    createSharedJsonStore<{ items: string[] }>({
      file: () => file,
      parse: (raw) => {
        const items = (raw as { items?: unknown })?.items;
        return { items: Array.isArray(items) ? (items as string[]) : [] };
      },
    });

  it('starts empty, persists updates and leaves no lock or temp files', async () => {
    const store = makeStore();
    expect(store.read()).toEqual({ items: [] });
    await store.update((s) => { s.items.push('a'); });
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ items: ['a'] });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.lock') || f.endsWith('.tmp'))).toEqual([]);
  });

  it('sees a change another process wrote to the file after it was cached', async () => {
    const store = makeStore();
    await store.update((s) => { s.items.push('mine'); });
    expect(store.read().items).toEqual(['mine']);

    fs.writeFileSync(file, JSON.stringify({ items: ['mine', 'theirs-with-a-different-size'] }));
    expect(store.read().items).toEqual(['mine', 'theirs-with-a-different-size']);
  });

  it('an update after an external write keeps the external change (no lost update)', async () => {
    const store = makeStore();
    await store.update((s) => { s.items.push('a'); });
    store.read(); // cache is now warm and stale-prone

    fs.writeFileSync(file, JSON.stringify({ items: ['a', 'external'] }));
    await store.update((s) => { s.items.push('b'); });

    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).items).toEqual(['a', 'external', 'b']);
  });

  it('concurrent updates in one process are all applied', async () => {
    const store = makeStore();
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.update((s) => { s.items.push(`i${i}`); })));
    expect(store.read().items).toHaveLength(20);
  });

  it('a throwing mutation writes nothing and does not block later updates', async () => {
    const store = makeStore();
    await store.update((s) => { s.items.push('kept'); });
    await expect(store.update((s) => { s.items.push('discarded'); throw new Error('nope'); })).rejects.toThrow('nope');
    await store.update((s) => { s.items.push('after'); });
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).items).toEqual(['kept', 'after']);
  });

  it('updateSync is locked read-modify-write too', () => {
    const store = makeStore();
    store.updateSync((s) => { s.items.push('x'); });
    fs.writeFileSync(file, JSON.stringify({ items: ['x', 'external'] }));
    store.updateSync((s) => { s.items.push('y'); });
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).items).toEqual(['x', 'external', 'y']);
  });
});

describe('cached JSON stores are safe across processes (#158)', () => {
  let dir: string;
  const worker = path.resolve(__dirname, '..', 'fixtures', 'lockWorker.ts');
  const envKeys = ['IDENTITY_STORE_FILE', 'TASK_LEDGER_FILE', 'SKILL_PROPOSAL_FILE', 'CONVERSATION_HISTORY_FILE'];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-multiproc-'));
    for (const k of [...envKeys, 'DATA_DIR']) savedEnv[k] = process.env[k];
    for (const k of envKeys) delete process.env[k];
    process.env.DATA_DIR = dir;
    _resetDataDirCache();
    _resetIdentityStoreForTests();
    _resetTaskLedgerForTests();
    _resetSkillProposalsForTests();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetDataDirCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const runWorker = (mode: string, count: number, tag: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', worker, mode, dir, String(count), tag], {
        env: { ...process.env, DATA_DIR: dir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}: ${stderr}`))));
    });

  const PROCESSES = 3;
  const PER_PROCESS = 6;
  const runAll = (mode: string) =>
    Promise.all(Array.from({ length: PROCESSES }, (_, p) => runWorker(mode, PER_PROCESS, `p${p}`)));
  const noLeftovers = () => fs.readdirSync(dir).filter((f) => f.endsWith('.lock') || f.endsWith('.tmp'));

  it('identities: every channel identity written by 3 processes survives', async () => {
    await runAll('identity');
    const identities = listChannelIdentities().filter((i) => i.subject.startsWith('p'));
    expect(identities).toHaveLength(PROCESSES * PER_PROCESS);
    expect(getPerson(identities[0].personId)).toBeDefined();
    expect(noLeftovers()).toEqual([]);
  }, 90_000);

  it('task ledger: every task started by 3 processes survives, and this process sees them', async () => {
    expect(getTask('p0-0')).toBeUndefined(); // warm the cache before the other processes write
    await runAll('task');
    const ids = Array.from({ length: PROCESSES }, (_, p) => Array.from({ length: PER_PROCESS }, (_, i) => `p${p}-${i}`)).flat();
    expect(ids.filter((id) => !getTask(id))).toEqual([]);
    expect(noLeftovers()).toEqual([]);
  }, 90_000);

  it('skill proposals: every proposal created by 3 processes survives', async () => {
    await runAll('proposal');
    expect(listSkillProposals(500)).toHaveLength(PROCESSES * PER_PROCESS);
    expect(noLeftovers()).toEqual([]);
  }, 90_000);

  it('skill proposals: a duplicate pending name created by another process is rejected', async () => {
    const input = {
      name: 'shared_name_skill',
      description: 'd',
      problem: 'p',
      proposedCode: 'return "ok";',
      testPlan: [],
      riskLevel: 'low' as const,
    };
    await createSkillProposal(input);
    expect(listSkillProposals()).toHaveLength(1); // cache is warm
    // Another process (simulated by writing the file directly) adds a pending proposal with a new name.
    const file = path.join(dir, 'skill_proposals.json');
    const store = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const other = { ...Object.values<Record<string, unknown>>(store.proposals)[0], id: 'proposal-other', name: 'other_name_skill' };
    store.proposals['proposal-other'] = other;
    store.order.push('proposal-other');
    fs.writeFileSync(file, JSON.stringify(store));

    await expect(createSkillProposal({ ...input, name: 'other_name_skill' })).rejects.toThrow(/pending proposal/);
    expect(listSkillProposals()).toHaveLength(2);
  });

  it('history: every session saved by 3 processes survives', async () => {
    await runAll('history');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'conversation_history.json'), 'utf-8')) as Record<string, unknown>;
    expect(Object.keys(saved)).toHaveLength(PROCESSES * PER_PROCESS);
    expect(noLeftovers()).toEqual([]);
  }, 90_000);

  it('violation log: every violation recorded by 3 processes survives, and this process sees them', async () => {
    expect(listViolations()).toEqual([]);
    await runAll('violation');
    expect(listViolations(200)).toHaveLength(PROCESSES * PER_PROCESS);
    recordViolation('mine', ['e'], 'c');
    expect(listViolations(200)).toHaveLength(PROCESSES * PER_PROCESS + 1);
    expect(noLeftovers()).toEqual([]);
  }, 90_000);

  it('identities: a person created by another process is reused, not duplicated', async () => {
    const first = await resolveIdentity('api', 'shared-user');
    await runWorker('identity', 1, 'shared'); // a different subject, written by another process
    const again = await resolveIdentity('api', 'shared-user');
    expect(again.personId).toBe(first.personId);
    expect(listChannelIdentities().map((i) => i.subject).sort()).toEqual(['shared-0', 'shared-user']);
  }, 60_000);
});
