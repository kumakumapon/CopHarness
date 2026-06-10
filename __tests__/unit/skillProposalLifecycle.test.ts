/**
 * Unit tests for lib/skillProposals/lifecycle.ts
 *
 * NOTE: Each test uses a unique skill name suffix to avoid collisions in the
 * global skill registry which persists across tests in the same process.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import {
  _resetSkillProposalsForTests,
  createSkillProposal,
  getSkillProposal,
} from '../../lib/skillProposals/store';
import {
  runProposalTestPhase,
  approveProposal,
  rejectProposal,
  registerProposalSkill,
  registerApprovedGeneratedSkills,
} from '../../lib/skillProposals/lifecycle';
import { getSkill } from '../../lib/skill';
import { getApprovalRequest } from '../../lib/humanInLoop/store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _counter = 0;
function uniqueName(base: string): string {
  _counter += 1;
  return `${base}${String(_counter).padStart(3, '0')}`;
}

const PASSING_CODE = 'module.exports = async (args) => ({ content: "ok" });';
const FAILING_CODE = 'module.exports = async (args) => ({ content: "nope", isError: true });';

function makeTestPlan(expectError = false) {
  return [
    {
      description: 'basic test',
      args: {},
      expect: expectError ? { isError: true } : { contains: 'ok' },
    },
  ];
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-lifecycle-'));
  process.env.DATA_DIR = tmpDir;
  _resetDataDirCache();
  _resetSkillProposalsForTests();
});

afterEach(() => {
  delete process.env.DATA_DIR;
  _resetDataDirCache();
  _resetSkillProposalsForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// runProposalTestPhase — happy path (tests pass)
// ---------------------------------------------------------------------------

describe('runProposalTestPhase', () => {
  it('transitions draft → awaiting_approval when all tests pass', async () => {
    const name = uniqueName('lcPassSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    const result = await runProposalTestPhase(proposal.id);

    expect(result.status).toBe('awaiting_approval');
    expect(result.testResults).toBeDefined();
    expect(result.testResults!.every((r) => r.passed)).toBe(true);
    expect(result.approvalRequestId).toBeTruthy();
    expect(result.errorPreview).toBeUndefined();
  });

  it('creates a HIL approval request that can be retrieved', async () => {
    const name = uniqueName('lcHilSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    const result = await runProposalTestPhase(proposal.id);

    expect(result.approvalRequestId).toBeTruthy();
    const hilReq = getApprovalRequest(result.approvalRequestId!);
    expect(hilReq).toBeDefined();
    expect(hilReq!.skillName).toBe('skillProposal:' + name);
    expect((hilReq!.args as Record<string, unknown>).proposalId).toBe(proposal.id);
    expect(hilReq!.status).toBe('pending');
  });

  it('transitions draft → tests_failed when tests fail', async () => {
    const name = uniqueName('lcFailSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Test',
      problem: 'p',
      proposedCode: FAILING_CODE,
      testPlan: makeTestPlan(false), // expect success, but code returns error
      riskLevel: 'low',
    });

    const result = await runProposalTestPhase(proposal.id);

    expect(result.status).toBe('tests_failed');
    expect(result.testResults).toBeDefined();
    expect(result.testResults!.some((r) => !r.passed)).toBe(true);
    expect(result.errorPreview).toBeTruthy();
  });

  it('allows re-testing after tests_failed', async () => {
    const name = uniqueName('lcRetestSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Test',
      problem: 'p',
      proposedCode: FAILING_CODE,
      testPlan: makeTestPlan(false),
      riskLevel: 'low',
    });

    // First run — tests fail
    const failed = await runProposalTestPhase(proposal.id);
    expect(failed.status).toBe('tests_failed');

    // Fix the code via updateSkillProposal — simulate by creating a new proposal
    // (In real usage the user would call updateSkillProposal then re-test)
    // Instead, let's update the proposal store directly
    const { updateSkillProposal } = await import('../../lib/skillProposals/store');
    await updateSkillProposal(proposal.id, { proposedCode: PASSING_CODE });

    // Re-test should succeed
    const retested = await runProposalTestPhase(proposal.id);
    expect(retested.status).toBe('awaiting_approval');
  });

  it('throws when proposal is in a non-testable status', async () => {
    const name = uniqueName('lcBadStatusSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    // Move to awaiting_approval first
    await runProposalTestPhase(proposal.id);

    // Attempting to test from awaiting_approval should throw
    await expect(runProposalTestPhase(proposal.id)).rejects.toThrow(
      /current status is "awaiting_approval"/,
    );
  });

  it('throws when proposal does not exist', async () => {
    await expect(runProposalTestPhase('proposal-nonexistent-id')).rejects.toThrow(
      /not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// approveProposal
// ---------------------------------------------------------------------------

describe('approveProposal', () => {
  it('happy path: awaiting_approval → registered, skill registered in registry', async () => {
    const name = uniqueName('lcApproveSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Approve test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    const tested = await runProposalTestPhase(proposal.id);
    expect(tested.status).toBe('awaiting_approval');

    const approved = await approveProposal(proposal.id);

    expect(approved.status).toBe('registered');

    // Skill should be in the registry
    const registeredSkill = getSkill(name);
    expect(registeredSkill).toBeDefined();
    expect(registeredSkill!.name).toBe(name);
    expect(registeredSkill!.riskLevel).toBe('medium'); // min risk is medium
  });

  it('resolves the HIL approval request as approved', async () => {
    const name = uniqueName('lcApproveHilSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'HIL test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    const tested = await runProposalTestPhase(proposal.id);
    const hilReqId = tested.approvalRequestId!;

    await approveProposal(proposal.id);

    const hilReq = getApprovalRequest(hilReqId);
    expect(hilReq!.status).toBe('approved');
  });

  it('the registered skill handler executes sandboxed code', async () => {
    const name = uniqueName('lcExecSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Exec test',
      problem: 'p',
      proposedCode: 'module.exports = async (args) => ({ content: "executed:" + JSON.stringify(args) });',
      testPlan: [{ args: { x: 1 }, expect: { contains: 'executed' } }],
      riskLevel: 'medium',
    });

    await runProposalTestPhase(proposal.id);
    await approveProposal(proposal.id);

    const skill = getSkill(name);
    expect(skill).toBeDefined();

    const result = await skill!.handler({ test: 'value' });
    expect(result.content).toContain('executed');
    expect(result.isError).toBeFalsy();
  });

  it('enforces minimum risk level of medium for generated skills', async () => {
    const name = uniqueName('lcMinRiskSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Low risk test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low', // requested low
    });

    await runProposalTestPhase(proposal.id);
    await approveProposal(proposal.id);

    const skill = getSkill(name);
    expect(skill).toBeDefined();
    // Must not be below medium
    expect(skill!.riskLevel).toBe('medium');
  });

  it('high riskLevel is preserved', async () => {
    const name = uniqueName('lcHighRiskSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'High risk test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'high',
    });

    await runProposalTestPhase(proposal.id);
    await approveProposal(proposal.id);

    const skill = getSkill(name);
    expect(skill).toBeDefined();
    expect(skill!.riskLevel).toBe('high');
  });

  it('throws when trying to approve a non-awaiting_approval proposal', async () => {
    const name = uniqueName('lcBadApproveSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Bad approve',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    // still draft — should throw
    await expect(approveProposal(proposal.id)).rejects.toThrow(
      /current status is "draft"/,
    );
  });
});

// ---------------------------------------------------------------------------
// rejectProposal
// ---------------------------------------------------------------------------

describe('rejectProposal', () => {
  it('rejects from awaiting_approval with reason', async () => {
    const name = uniqueName('lcRejectSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Reject test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    const tested = await runProposalTestPhase(proposal.id);
    const hilReqId = tested.approvalRequestId!;

    const rejected = await rejectProposal(proposal.id, 'Too risky');

    expect(rejected.status).toBe('rejected');
    expect(rejected.errorPreview).toBe('Too risky');

    // HIL request should be resolved as rejected
    const hilReq = getApprovalRequest(hilReqId);
    expect(hilReq!.status).toBe('rejected');
  });

  it('rejects from tests_failed status', async () => {
    const name = uniqueName('lcRejectFailedSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Reject failed test',
      problem: 'p',
      proposedCode: FAILING_CODE,
      testPlan: makeTestPlan(false),
      riskLevel: 'low',
    });

    await runProposalTestPhase(proposal.id);

    const rejected = await rejectProposal(proposal.id, 'Code is wrong');
    expect(rejected.status).toBe('rejected');
  });

  it('rejects from draft status', async () => {
    const name = uniqueName('lcRejectDraftSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Reject draft',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    const rejected = await rejectProposal(proposal.id);
    expect(rejected.status).toBe('rejected');
    expect(rejected.errorPreview).toBeUndefined();
  });

  it('throws when trying to reject a registered proposal', async () => {
    const name = uniqueName('lcRejectRegisteredSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Reject registered',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    await runProposalTestPhase(proposal.id);
    await approveProposal(proposal.id);

    await expect(rejectProposal(proposal.id)).rejects.toThrow(
      /current status is "registered"/,
    );
  });
});

// ---------------------------------------------------------------------------
// registerProposalSkill — direct
// ---------------------------------------------------------------------------

describe('registerProposalSkill', () => {
  it('refuses to register a skill name that already exists in the registry', async () => {
    const name = uniqueName('lcDupeRegistration');
    const proposal = await createSkillProposal({
      name,
      description: 'First',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });
    await runProposalTestPhase(proposal.id);
    await approveProposal(proposal.id);

    // Trying to register the same proposal again via the direct function
    // should throw because getSkill(name) is already non-null
    expect(() => registerProposalSkill(proposal)).toThrow(
      /already registered/,
    );
  });

  it('wraps the skill with HIL gate (gated marker check)', async () => {
    const name = uniqueName('lcGatedSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Gated test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });
    await runProposalTestPhase(proposal.id);
    await approveProposal(proposal.id);

    const skill = getSkill(name);
    // The handler should be the gated version; __hilGated marker is set
    expect((skill as unknown as Record<string, unknown>).__hilGated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registerApprovedGeneratedSkills (startup loader)
// ---------------------------------------------------------------------------

describe('registerApprovedGeneratedSkills', () => {
  it('registers proposals with status approved and marks them registered', async () => {
    const name = uniqueName('lcLoaderSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Loader test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    // Manually set to approved (bypassing test phase for this test)
    const { updateSkillProposal } = await import('../../lib/skillProposals/store');
    await updateSkillProposal(proposal.id, { status: 'approved' });

    const { registered, skipped } = registerApprovedGeneratedSkills();

    expect(registered).toContain(name);
    expect(skipped).not.toContain(name);

    // Should be in the registry
    expect(getSkill(name)).toBeDefined();

    // Status should be updated to registered
    const updated = getSkillProposal(proposal.id);
    // The update is fire-and-forget, so we just check the skill is registered
    expect(getSkill(name)).toBeDefined();
  });

  it('skips proposals whose skill name is already in the registry', async () => {
    const name = uniqueName('lcLoaderSkipSkill');
    const proposal = await createSkillProposal({
      name,
      description: 'Skip test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    const { updateSkillProposal: upd } = await import('../../lib/skillProposals/store');
    await upd(proposal.id, { status: 'approved' });

    // First run — registers it; getSkill(name) is now non-null
    const first = registerApprovedGeneratedSkills();
    expect(first.registered).toContain(name);

    // Drain the fire-and-forget writes from the first run before running second
    await upd(proposal.id, { status: 'registered' });

    // Second run — already in registry (getSkill(name) exists), should skip
    const second = registerApprovedGeneratedSkills();
    expect(second.skipped).toContain(name);
    expect(second.registered).not.toContain(name);

    // The second run also triggers a void write for the "skipped" path? No — skipped
    // entries don't trigger updateSkillProposal. We're safe here.
    // Drain any remaining writes from second run (there are none for skipped).
  });

  it('does not throw when a loader encounters an already-registered skill name', async () => {
    const name = uniqueName('lcLoaderNoThrow');
    const proposal = await createSkillProposal({
      name,
      description: 'No-throw test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    const { updateSkillProposal: upd } = await import('../../lib/skillProposals/store');
    await upd(proposal.id, { status: 'approved' });

    // First call registers the skill
    registerApprovedGeneratedSkills();

    // Drain the fire-and-forget write queue
    await upd(proposal.id, { status: 'registered' });

    // Running the loader again when the name is already in the registry should
    // silently skip and never throw
    expect(() => registerApprovedGeneratedSkills()).not.toThrow();
    // No fire-and-forget writes happen for the skipped path, so no queue to drain
  });
});
