import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import {
  _resetSkillProposalsForTests,
  createSkillProposal,
  getSkillProposal,
  getSkillProposalByName,
  listSkillProposals,
  querySkillProposals,
  updateSkillProposal,
  type SkillProposal,
} from '../../lib/skillProposals/store';

// Minimal valid input for creating a proposal
function makeInput(overrides: Partial<Omit<SkillProposal, 'id' | 'status' | 'createdAt' | 'updatedAt'>> = {}) {
  return {
    name: 'mySkillOne',
    description: 'Does something useful',
    problem: 'Solves a recurring chore',
    proposedCode: 'return { content: "hello" };',
    testPlan: [],
    riskLevel: 'low' as const,
    ...overrides,
  };
}

describe('SkillProposalStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-skill-proposals-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetSkillProposalsForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.SKILL_PROPOSAL_FILE;
    _resetDataDirCache();
    _resetSkillProposalsForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // createSkillProposal
  // -------------------------------------------------------------------------

  it('creates a proposal with draft status and auto-generated id', async () => {
    const proposal = await createSkillProposal(makeInput());

    expect(proposal.id).toMatch(/^proposal-/);
    expect(proposal.status).toBe('draft');
    expect(proposal.name).toBe('mySkillOne');
    expect(proposal.riskLevel).toBe('low');
    expect(proposal.createdAt).toBeTruthy();
    expect(proposal.updatedAt).toBeTruthy();
  });

  it('rejects names that do not match the pattern (too short)', async () => {
    // Name must be 3-64 chars; "ab" is only 2 chars after the leading letter
    await expect(createSkillProposal(makeInput({ name: 'ab' }))).rejects.toThrow(
      /Invalid skill name/,
    );
  });

  it('rejects names that start with a digit', async () => {
    await expect(createSkillProposal(makeInput({ name: '1badName' }))).rejects.toThrow(
      /Invalid skill name/,
    );
  });

  it('rejects names with hyphens', async () => {
    await expect(createSkillProposal(makeInput({ name: 'bad-name' }))).rejects.toThrow(
      /Invalid skill name/,
    );
  });

  it('accepts a valid 3-char name', async () => {
    const p = await createSkillProposal(makeInput({ name: 'abc' }));
    expect(p.name).toBe('abc');
  });

  it('rejects duplicate pending proposals with the same name', async () => {
    await createSkillProposal(makeInput({ name: 'dupeName' }));
    await expect(createSkillProposal(makeInput({ name: 'dupeName' }))).rejects.toThrow(
      /pending proposal for skill "dupeName"/,
    );
  });

  it('allows a new proposal when the previous one was rejected', async () => {
    const first = await createSkillProposal(makeInput({ name: 'retrySkill' }));
    await updateSkillProposal(first.id, { status: 'rejected' });
    const second = await createSkillProposal(makeInput({ name: 'retrySkill' }));
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('draft');
  });

  it('allows a new proposal when the previous one was registered', async () => {
    const first = await createSkillProposal(makeInput({ name: 'regSkill' }));
    await updateSkillProposal(first.id, { status: 'registered' });
    const second = await createSkillProposal(makeInput({ name: 'regSkill' }));
    expect(second.status).toBe('draft');
  });

  // -------------------------------------------------------------------------
  // updateSkillProposal — status flow
  // -------------------------------------------------------------------------

  it('updates status and bumps updatedAt', async () => {
    const p = await createSkillProposal(makeInput());
    const originalUpdatedAt = p.updatedAt;

    // Ensure at least 1ms passes
    await new Promise((r) => setTimeout(r, 2));
    const updated = await updateSkillProposal(p.id, { status: 'testing' });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe('testing');
    expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
    expect(updated!.createdAt).toBe(p.createdAt);
  });

  it('can set testResults via update', async () => {
    const p = await createSkillProposal(makeInput());
    const updated = await updateSkillProposal(p.id, {
      status: 'awaiting_approval',
      testResults: [{ index: 0, passed: true, detail: 'ok' }],
    });
    expect(updated!.testResults).toHaveLength(1);
    expect(updated!.testResults![0].passed).toBe(true);
  });

  it('returns undefined when updating a non-existent id', async () => {
    const result = await updateSkillProposal('proposal-does-not-exist', { status: 'testing' });
    expect(result).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // getSkillProposal / getSkillProposalByName
  // -------------------------------------------------------------------------

  it('retrieves a proposal by id', async () => {
    const p = await createSkillProposal(makeInput({ name: 'findById' }));
    const found = getSkillProposal(p.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(p.id);
  });

  it('returns undefined for unknown id', () => {
    expect(getSkillProposal('proposal-unknown')).toBeUndefined();
  });

  it('retrieves the most recent proposal by name', async () => {
    const first = await createSkillProposal(makeInput({ name: 'byName' }));
    await updateSkillProposal(first.id, { status: 'rejected' });
    const second = await createSkillProposal(makeInput({ name: 'byName' }));

    const found = getSkillProposalByName('byName');
    expect(found!.id).toBe(second.id);
  });

  it('returns undefined for unknown name', () => {
    expect(getSkillProposalByName('nonexistentSkill')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // listSkillProposals / querySkillProposals
  // -------------------------------------------------------------------------

  it('lists proposals newest first', async () => {
    const a = await createSkillProposal(makeInput({ name: 'aaa' }));
    const b = await createSkillProposal(makeInput({ name: 'bbb' }));
    const c = await createSkillProposal(makeInput({ name: 'ccc' }));

    const list = listSkillProposals(10);
    expect(list.map((p) => p.id)).toEqual([c.id, b.id, a.id]);
  });

  it('filters by status', async () => {
    const draft = await createSkillProposal(makeInput({ name: 'draftOne' }));
    const testing = await createSkillProposal(makeInput({ name: 'testingOne' }));
    await updateSkillProposal(testing.id, { status: 'testing' });

    const result = querySkillProposals({ status: 'testing' });
    expect(result.total).toBe(1);
    expect(result.proposals[0].id).toBe(testing.id);

    const draftResult = querySkillProposals({ status: 'draft' });
    expect(draftResult.proposals.map((p) => p.id)).toContain(draft.id);
  });

  it('filters by nameQuery (partial, case-insensitive)', async () => {
    await createSkillProposal(makeInput({ name: 'weatherForecast' }));
    await createSkillProposal(makeInput({ name: 'calcTax' }));

    const result = querySkillProposals({ nameQuery: 'WEATHER' });
    expect(result.total).toBe(1);
    expect(result.proposals[0].name).toBe('weatherForecast');
  });

  it('filters by riskLevel', async () => {
    await createSkillProposal(makeInput({ name: 'lowRisk', riskLevel: 'low' }));
    await createSkillProposal(makeInput({ name: 'highRisk', riskLevel: 'high' }));

    const result = querySkillProposals({ riskLevel: 'high' });
    expect(result.total).toBe(1);
    expect(result.proposals[0].name).toBe('highRisk');
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await createSkillProposal(makeInput({ name: `skill${String(i).padStart(2, '0')}x` }));
    }
    const result = querySkillProposals({ limit: 3 });
    expect(result.proposals).toHaveLength(3);
    expect(result.total).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Persistence across reset (re-read from file)
  // -------------------------------------------------------------------------

  it('persists proposals to disk and reloads them after reset', async () => {
    const p = await createSkillProposal(makeInput({ name: 'persistMe' }));
    await updateSkillProposal(p.id, { status: 'testing' });

    // Drain write queue by resetting (in tests the queue is awaited via the async functions above)
    // Reset in-memory state to force a re-read from disk
    _resetSkillProposalsForTests();

    const reloaded = getSkillProposal(p.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.name).toBe('persistMe');
    expect(reloaded!.status).toBe('testing');
  });

  it('uses SKILL_PROPOSAL_FILE env override when set', async () => {
    const customFile = path.join(tmpDir, 'custom_proposals.json');
    process.env.SKILL_PROPOSAL_FILE = customFile;
    _resetSkillProposalsForTests();

    await createSkillProposal(makeInput({ name: 'envOverride' }));

    expect(fs.existsSync(customFile)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(customFile, 'utf-8')) as { proposals: Record<string, unknown> };
    const names = Object.values(raw.proposals).map((p) => (p as SkillProposal).name);
    expect(names).toContain('envOverride');
  });
});

describe('Generated skill manifest validation', () => {
  it('adds a default manifest for new proposals', async () => {
    const name = `manifestDefaultX${Date.now()}`;
    const proposal = await createSkillProposal(makeInput({ name }));

    expect(proposal.manifest).toEqual({
      name,
      version: '0.1.0',
      riskLevel: 'low',
      permissions: [],
      allowedEnv: [],
      allowedNetworkDestinations: [],
      npmDependencies: [],
    });
    expect(proposal.manifestHistory).toHaveLength(1);
  });

  it('rejects unapproved generated skill dependencies', async () => {
    const name = `manifestDepsX${Date.now()}`;
    await expect(createSkillProposal(makeInput({
      name,
      manifest: {
        name,
        version: '0.1.0',
        riskLevel: 'low',
        permissions: ['dependencies'],
        allowedEnv: [],
        allowedNetworkDestinations: [],
        npmDependencies: ['left-pad'],
      },
    }))).rejects.toThrow(/dependency "left-pad" is not approved/);
  });

  it('accepts allowlisted generated skill dependencies', async () => {
    process.env.GENERATED_SKILL_ALLOWED_DEPENDENCIES = 'left-pad';
    const name = `manifestAllowDepsX${Date.now()}`;
    const proposal = await createSkillProposal(makeInput({
      name,
      manifest: {
        name,
        version: '0.1.0',
        riskLevel: 'low',
        permissions: ['dependencies'],
        allowedEnv: [],
        allowedNetworkDestinations: [],
        npmDependencies: ['left-pad'],
      },
    }));

    expect(proposal.manifest.npmDependencies).toEqual(['left-pad']);
    delete process.env.GENERATED_SKILL_ALLOWED_DEPENDENCIES;
  });
});
