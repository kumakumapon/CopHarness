import type { SkillDefinition } from '../../lib/skill';
import { isHilEnabled, wrapWithGate, applyGatesToRegistry } from '../../lib/humanInLoop/gate';

jest.mock('../../lib/humanInLoop/store', () => ({
  createApprovalRequest: jest.fn().mockReturnValue({ id: 'approval-1' }),
  waitForApproval: jest.fn().mockResolvedValue('approved'),
}));

jest.mock('../../lib/skills/executionContext', () => ({
  getSkillExecutionContext: jest.fn().mockReturnValue({ personId: 'p1', channelKey: 'c1' }),
  updateSkillExecutionContext: jest.fn(),
}));

jest.mock('../../lib/toolPolicy/policy', () => ({
  evaluateToolPolicy: jest.fn().mockReturnValue({ decision: 'allowed' }),
}));

import { createApprovalRequest, waitForApproval } from '../../lib/humanInLoop/store';
import { getSkillExecutionContext, updateSkillExecutionContext } from '../../lib/skills/executionContext';
import { evaluateToolPolicy } from '../../lib/toolPolicy/policy';

const mockCreateApprovalRequest = createApprovalRequest as jest.MockedFunction<typeof createApprovalRequest>;
const mockWaitForApproval = waitForApproval as jest.MockedFunction<typeof waitForApproval>;
const mockGetSkillExecutionContext = getSkillExecutionContext as jest.MockedFunction<typeof getSkillExecutionContext>;
const mockUpdateSkillExecutionContext = updateSkillExecutionContext as jest.MockedFunction<typeof updateSkillExecutionContext>;
const mockEvaluateToolPolicy = evaluateToolPolicy as jest.MockedFunction<typeof evaluateToolPolicy>;

function makeSkill(overrides?: Partial<SkillDefinition>): SkillDefinition {
  return {
    name: 'testSkill',
    description: 'A test skill',
    parameters: { type: 'object' as const, properties: {} },
    handler: jest.fn().mockResolvedValue({ content: 'ok' }),
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.HIL_ENABLED;
  jest.clearAllMocks();
  // Restore default mock return values after clearing
  mockCreateApprovalRequest.mockReturnValue({ id: 'approval-1' } as ReturnType<typeof createApprovalRequest>);
  mockWaitForApproval.mockResolvedValue('approved');
  mockGetSkillExecutionContext.mockReturnValue({ personId: 'p1', channelKey: 'c1' });
  mockEvaluateToolPolicy.mockReturnValue({ decision: 'allowed', mode: 'alwaysAllow', reason: 'default' });
});

// ---------------------------------------------------------------------------
// isHilEnabled
// ---------------------------------------------------------------------------

describe('isHilEnabled()', () => {
  it('returns true when HIL_ENABLED is "true"', () => {
    process.env.HIL_ENABLED = 'true';
    expect(isHilEnabled()).toBe(true);
  });

  it('returns true when HIL_ENABLED is "1"', () => {
    process.env.HIL_ENABLED = '1';
    expect(isHilEnabled()).toBe(true);
  });

  it('returns false when HIL_ENABLED is not set', () => {
    delete process.env.HIL_ENABLED;
    expect(isHilEnabled()).toBe(false);
  });

  it('returns false when HIL_ENABLED is "false"', () => {
    process.env.HIL_ENABLED = 'false';
    expect(isHilEnabled()).toBe(false);
  });

  it('returns false when HIL_ENABLED is an empty string', () => {
    process.env.HIL_ENABLED = '';
    expect(isHilEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// wrapWithGate — policy routing
// ---------------------------------------------------------------------------

describe('wrapWithGate() — policy decision routing', () => {
  it('calls original handler when policy decision is "allowed"', async () => {
    mockEvaluateToolPolicy.mockReturnValue({ decision: 'allowed', mode: 'alwaysAllow', reason: 'ok' });
    const skill = makeSkill();
    const wrapped = wrapWithGate(skill);

    const result = await wrapped.handler({ x: 1 });

    expect(skill.handler).toHaveBeenCalledWith({ x: 1 });
    expect(result).toEqual({ content: 'ok' });
  });

  it('calls original handler when policy decision is "dry_run_allowed"', async () => {
    mockEvaluateToolPolicy.mockReturnValue({ decision: 'dry_run_allowed', mode: 'allowWithDryRun', reason: 'dry run' });
    const skill = makeSkill();
    const wrapped = wrapWithGate(skill);

    const result = await wrapped.handler({});

    expect(skill.handler).toHaveBeenCalled();
    expect(result).toEqual({ content: 'ok' });
  });

  it('returns an error result when policy decision is "denied"', async () => {
    mockEvaluateToolPolicy.mockReturnValue({ decision: 'denied', mode: 'deny', ruleId: 'rule-42', reason: 'blocked' });
    const skill = makeSkill({ name: 'dangerSkill' });
    const wrapped = wrapWithGate(skill);

    const result = await wrapped.handler({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain('dangerSkill');
    expect(result.content).toContain('ポリシーにより拒否');
    expect(skill.handler).not.toHaveBeenCalled();
  });

  it('includes the ruleId in the denial message when present', async () => {
    mockEvaluateToolPolicy.mockReturnValue({ decision: 'denied', mode: 'deny', ruleId: 'my-rule', reason: 'nope' });
    const skill = makeSkill();
    const wrapped = wrapWithGate(skill);

    const result = await wrapped.handler({});

    expect(result.content).toContain('rule=my-rule');
  });
});

// ---------------------------------------------------------------------------
// wrapWithGate — approval_required flow
// ---------------------------------------------------------------------------

describe('wrapWithGate() — approval_required flow', () => {
  beforeEach(() => {
    mockEvaluateToolPolicy.mockReturnValue({ decision: 'approval_required', mode: 'requireApproval', ruleId: 'r1', reason: 'needs approval' });
  });

  it('creates an approval request and waits for it', async () => {
    const skill = makeSkill({ name: 'gatedSkill' });
    const wrapped = wrapWithGate(skill);
    await wrapped.handler({ param: 'value' });

    expect(mockCreateApprovalRequest).toHaveBeenCalledWith('gatedSkill', { param: 'value' }, 'p1', 'r1');
    expect(mockWaitForApproval).toHaveBeenCalledWith('approval-1', expect.any(Number));
  });

  it('calls original handler and returns success when approval is granted', async () => {
    mockWaitForApproval.mockResolvedValue('approved');
    const skill = makeSkill();
    const wrapped = wrapWithGate(skill);

    const result = await wrapped.handler({});

    expect(skill.handler).toHaveBeenCalled();
    expect(result).toEqual({ content: 'ok' });
    expect(result.isError).toBeUndefined();
  });

  it('returns an error with timeout message when approval times out', async () => {
    mockWaitForApproval.mockResolvedValue('timeout');
    const skill = makeSkill({ name: 'slowSkill' });
    const wrapped = wrapWithGate(skill);

    const result = await wrapped.handler({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain('タイムアウトにより拒否');
    expect(skill.handler).not.toHaveBeenCalled();
  });

  it('returns an error with rejection message when approval is rejected', async () => {
    mockWaitForApproval.mockResolvedValue('rejected');
    const skill = makeSkill({ name: 'rejectedSkill' });
    const wrapped = wrapWithGate(skill);

    const result = await wrapped.handler({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain('人間によって拒否');
    expect(skill.handler).not.toHaveBeenCalled();
  });

  it('uses channelKey as requestedBy when personId is absent from context', async () => {
    mockGetSkillExecutionContext.mockReturnValue({ channelKey: 'chan-99' });
    const skill = makeSkill({ name: 'chanSkill' });
    const wrapped = wrapWithGate(skill);
    await wrapped.handler({});

    expect(mockCreateApprovalRequest).toHaveBeenCalledWith('chanSkill', {}, 'chan-99', 'r1');
  });
});

// ---------------------------------------------------------------------------
// wrapWithGate — execution context updates
// ---------------------------------------------------------------------------

describe('wrapWithGate() — execution context updates', () => {
  it('updates execution context with policy decision on any call', async () => {
    mockEvaluateToolPolicy.mockReturnValue({ decision: 'allowed', mode: 'alwaysAllow', reason: 'ok' });
    const skill = makeSkill();
    const wrapped = wrapWithGate(skill);
    await wrapped.handler({});

    expect(mockUpdateSkillExecutionContext).toHaveBeenCalledWith({ policyDecision: 'allowed' });
  });

  it('sets approvalId and policyDecision=approval_required in context before waiting', async () => {
    mockEvaluateToolPolicy.mockReturnValue({ decision: 'approval_required', mode: 'requireApproval', reason: 'needs it' });
    mockWaitForApproval.mockResolvedValue('approved');
    const skill = makeSkill();
    const wrapped = wrapWithGate(skill);
    await wrapped.handler({});

    expect(mockUpdateSkillExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'approval-1', policyDecision: 'approval_required' }),
    );
  });

  it('updates context with approvalStatus and final policyDecision after approval resolves', async () => {
    mockEvaluateToolPolicy.mockReturnValue({ decision: 'approval_required', mode: 'requireApproval', reason: 'needs it' });
    mockWaitForApproval.mockResolvedValue('approved');
    const skill = makeSkill();
    const wrapped = wrapWithGate(skill);
    await wrapped.handler({});

    expect(mockUpdateSkillExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({ approvalStatus: 'approved', policyDecision: 'approval_approved' }),
    );
  });

  it('sets policyDecision=approval_timeout when approval times out', async () => {
    mockEvaluateToolPolicy.mockReturnValue({ decision: 'approval_required', mode: 'requireApproval', reason: 'needs it' });
    mockWaitForApproval.mockResolvedValue('timeout');
    const skill = makeSkill();
    const wrapped = wrapWithGate(skill);
    await wrapped.handler({});

    expect(mockUpdateSkillExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({ approvalStatus: 'timeout', policyDecision: 'approval_timeout' }),
    );
  });
});

// ---------------------------------------------------------------------------
// wrapWithGate — double-wrapping prevention
// ---------------------------------------------------------------------------

describe('wrapWithGate() — double-wrapping prevention', () => {
  it('returns the same skill instance when wrapping an already-gated skill', () => {
    const skill = makeSkill();
    const wrapped = wrapWithGate(skill);
    const doubleWrapped = wrapWithGate(wrapped);

    expect(doubleWrapped).toBe(wrapped);
  });
});

// ---------------------------------------------------------------------------
// applyGatesToRegistry
// ---------------------------------------------------------------------------

describe('applyGatesToRegistry()', () => {
  it('returns an array of the same length as the input', () => {
    const skills = [makeSkill({ name: 'a' }), makeSkill({ name: 'b' }), makeSkill({ name: 'c' })];
    const result = applyGatesToRegistry(skills);

    expect(result).toHaveLength(3);
  });

  it('wraps every skill in the registry array', async () => {
    mockEvaluateToolPolicy.mockReturnValue({ decision: 'denied', mode: 'deny', reason: 'blocked' });
    const handlerA = jest.fn().mockResolvedValue({ content: 'a' });
    const handlerB = jest.fn().mockResolvedValue({ content: 'b' });
    const skills = [
      makeSkill({ name: 'skillA', handler: handlerA }),
      makeSkill({ name: 'skillB', handler: handlerB }),
    ];

    const result = applyGatesToRegistry(skills);

    for (const wrapped of result) {
      const res = await wrapped.handler({});
      expect(res.isError).toBe(true);
    }
    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('returns an empty array when given an empty array', () => {
    expect(applyGatesToRegistry([])).toEqual([]);
  });
});
