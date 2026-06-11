/**
 * Lifecycle management for SkillProposals.
 *
 * Handles test phase, approval, rejection, and registration into the skill
 * registry.
 */

import { type SkillDefinition } from '../skill';
import { getSkill, registerSkill } from '../skill';
import { wrapWithGate } from '../humanInLoop/gate';
import {
  createApprovalRequest,
  resolveApprovalRequest,
} from '../humanInLoop/store';
import {
  type SkillProposal,
  type SkillProposalStatus,
  getSkillProposal,
  updateSkillProposal,
  querySkillProposals,
} from './store';
import { runProposalCode, runProposalTests } from './sandbox';
import { runProposalCodeOnBackend } from './backendRunner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_GENERATED_TIMEOUT_MS = 3000;

function getGeneratedSkillTimeoutMs(): number {
  const raw = process.env.GENERATED_SKILL_TIMEOUT_MS;
  if (!raw) return DEFAULT_GENERATED_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GENERATED_TIMEOUT_MS;
}

/**
 * Return the appropriate runner function for generated skill code based on
 * the `GENERATED_SKILL_EXECUTION` environment variable.
 *
 * - `backend` → `runProposalCodeOnBackend` (ExecutionBackend: docker / ssh / local)
 * - `vm` / unset / any other value → `runProposalCode` (default node:vm sandbox)
 *
 * An unrecognised value triggers a warning and falls back to vm.
 * The mode is resolved **at call time** (not at register time) so that changing
 * the env var mid-process (e.g. in tests) is reflected immediately.
 */
export function getGeneratedSkillRunner(): (
  code: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number },
) => Promise<import('../skill').SkillResult> {
  const mode = (process.env.GENERATED_SKILL_EXECUTION ?? 'vm').toLowerCase();
  if (mode === 'backend') {
    return runProposalCodeOnBackend;
  }
  if (mode !== 'vm') {
    console.warn(
      `[lifecycle] Unknown GENERATED_SKILL_EXECUTION value "${process.env.GENERATED_SKILL_EXECUTION}". ` +
        `Falling back to "vm" sandbox.`,
    );
  }
  return runProposalCode;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertStatus(
  proposal: SkillProposal,
  allowed: SkillProposalStatus[],
  action: string,
): void {
  if (!allowed.includes(proposal.status)) {
    throw new Error(
      `Cannot ${action} proposal "${proposal.id}" (name="${proposal.name}"): ` +
        `current status is "${proposal.status}", expected one of: ${allowed.join(', ')}.`,
    );
  }
}

async function loadProposal(id: string, action: string): Promise<SkillProposal> {
  const proposal = getSkillProposal(id);
  if (!proposal) {
    throw new Error(`Proposal "${id}" not found (action=${action}).`);
  }
  return proposal;
}

// ---------------------------------------------------------------------------
// runProposalTestPhase
// ---------------------------------------------------------------------------

export async function runProposalTestPhase(id: string): Promise<SkillProposal> {
  const proposal = await loadProposal(id, 'runProposalTestPhase');
  // 'testing' is allowed so a proposal stranded by a crash mid-test can be retried.
  assertStatus(proposal, ['draft', 'tests_failed', 'testing'], 'run tests on');

  // Mark as testing
  await updateSkillProposal(id, { status: 'testing' });

  const testRun = await runProposalTests(
    { proposedCode: proposal.proposedCode, testPlan: proposal.testPlan },
    { timeoutMs: getGeneratedSkillTimeoutMs() },
    getGeneratedSkillRunner(),
  );

  if (testRun.passed) {
    // Create a HIL approval request for audit visibility
    const hilReq = createApprovalRequest(
      'skillProposal:' + proposal.name,
      { proposalId: proposal.id },
      proposal.personId ?? proposal.channelKey,
      'skill_proposal',
    );

    const updated = await updateSkillProposal(id, {
      status: 'awaiting_approval',
      testResults: testRun.results,
      errorPreview: undefined,
      approvalRequestId: hilReq.id,
    });
    return updated!;
  } else {
    // Find the first failing detail
    const firstFail = testRun.results.find((r) => !r.passed);
    const errorPreview = firstFail?.detail ?? 'Tests failed';

    const updated = await updateSkillProposal(id, {
      status: 'tests_failed',
      testResults: testRun.results,
      errorPreview,
    });
    return updated!;
  }
}

// ---------------------------------------------------------------------------
// approveProposal
// ---------------------------------------------------------------------------

export async function approveProposal(id: string): Promise<SkillProposal> {
  const proposal = await loadProposal(id, 'approveProposal');
  assertStatus(proposal, ['awaiting_approval'], 'approve');

  // Mark as approved and resolve the HIL request
  let updated = await updateSkillProposal(id, { status: 'approved' });
  if (proposal.approvalRequestId) {
    resolveApprovalRequest(proposal.approvalRequestId, 'approved');
  }

  // Attempt registration
  try {
    registerProposalSkill(updated!);
    updated = await updateSkillProposal(id, { status: 'registered' });
  } catch (err) {
    const errorPreview =
      err instanceof Error ? err.message : String(err);
    updated = await updateSkillProposal(id, { errorPreview });
  }

  return updated!;
}

// ---------------------------------------------------------------------------
// rejectProposal
// ---------------------------------------------------------------------------

export async function rejectProposal(id: string, reason?: string): Promise<SkillProposal> {
  const proposal = await loadProposal(id, 'rejectProposal');
  assertStatus(proposal, ['awaiting_approval', 'tests_failed', 'draft', 'testing'], 'reject');

  const patch: Partial<SkillProposal> = { status: 'rejected' };
  if (reason !== undefined) {
    patch.errorPreview = reason;
  }

  if (proposal.approvalRequestId) {
    resolveApprovalRequest(proposal.approvalRequestId, 'rejected');
  }

  const updated = await updateSkillProposal(id, patch);
  return updated!;
}

// ---------------------------------------------------------------------------
// registerProposalSkill
// ---------------------------------------------------------------------------

export function registerProposalSkill(proposal: SkillProposal): SkillDefinition {
  // Enforce minimum risk level of 'medium' for generated skills
  const effectiveRisk: 'medium' | 'high' =
    proposal.riskLevel === 'high' ? 'high' : 'medium';

  // Collision check
  if (getSkill(proposal.name)) {
    throw new Error(
      `Cannot register generated skill "${proposal.name}": a skill with this name is already registered.`,
    );
  }

  const timeoutMs = getGeneratedSkillTimeoutMs();

  const definition: SkillDefinition = {
    name: proposal.name,
    description: proposal.description,
    parameters: proposal.parameters
      ? (proposal.parameters as SkillDefinition['parameters'])
      : { type: 'object', properties: {} },
    category: 'generated',
    riskLevel: effectiveRisk,
    handler: (args: Record<string, unknown>) =>
      getGeneratedSkillRunner()(proposal.proposedCode, args, { timeoutMs }),
  };

  const gated = wrapWithGate(definition);
  registerSkill(gated);
  return definition;
}

// ---------------------------------------------------------------------------
// registerApprovedGeneratedSkills (startup loader)
// ---------------------------------------------------------------------------

export function registerApprovedGeneratedSkills(): {
  registered: string[];
  skipped: string[];
} {
  const registered: string[] = [];
  const skipped: string[] = [];

  const { proposals } = querySkillProposals({
    limit: 500,
  });

  const relevant = proposals.filter(
    (p) => p.status === 'approved' || p.status === 'registered',
  );

  for (const proposal of relevant) {
    // Skip if already in the registry
    if (getSkill(proposal.name)) {
      skipped.push(proposal.name);
      continue;
    }

    try {
      registerProposalSkill(proposal);
      registered.push(proposal.name);
      // Ensure status is 'registered' (fire-and-forget, errors suppressed)
      void updateSkillProposal(proposal.id, { status: 'registered' }).catch(() => undefined);
    } catch (err) {
      const errorPreview =
        err instanceof Error ? err.message : String(err);
      void updateSkillProposal(proposal.id, { errorPreview }).catch(() => undefined);
      // Never throw out of the loader
    }
  }

  return { registered, skipped };
}
