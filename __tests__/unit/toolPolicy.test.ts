import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SkillDefinition } from '../../lib/skill';
import { evaluateToolPolicy, _resetToolPolicyCacheForTests } from '../../lib/toolPolicy/policy';
import { wrapWithGate } from '../../lib/humanInLoop/gate';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

const highRiskSkill: SkillDefinition = {
  name: 'runCommand',
  description: 'Runs a command',
  parameters: { type: 'object', properties: {} },
  riskLevel: 'high',
  handler: async () => ({ content: 'executed' }),
};

describe('JSON tool policy', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-policy-'));
    process.env.DATA_DIR = tmpDir;
    _resetDataDirCache();
    _resetToolPolicyCacheForTests();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.TOOL_POLICY_FILE;
    delete process.env.HIL_ENABLED;
    _resetDataDirCache();
    _resetToolPolicyCacheForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('evaluates policy.json rules by skill, risk, and argument pattern', () => {
    fs.writeFileSync(path.join(tmpDir, 'policy.json'), JSON.stringify({
      version: 1,
      defaultApprovalMode: 'alwaysAllow',
      rules: [
        {
          id: 'deny-rm-rf',
          skills: ['runCommand'],
          riskLevels: ['high'],
          argumentPatterns: { command: 'rm\\s+-rf' },
          approvalMode: 'deny',
        },
        {
          id: 'approve-shell',
          skills: ['runCommand'],
          approvalMode: 'requireApproval',
        },
      ],
    }), 'utf8');

    expect(evaluateToolPolicy(highRiskSkill, { command: 'rm -rf /tmp/nope' })).toMatchObject({
      decision: 'denied',
      mode: 'deny',
      ruleId: 'deny-rm-rf',
    });
    expect(evaluateToolPolicy(highRiskSkill, { command: 'echo ok' })).toMatchObject({
      decision: 'approval_required',
      mode: 'requireApproval',
      ruleId: 'approve-shell',
    });
  });

  it('wraps skills with policy denial even when HIL_ENABLED is not set', async () => {
    fs.writeFileSync(path.join(tmpDir, 'policy.json'), JSON.stringify({
      version: 1,
      rules: [{ id: 'deny-shell', skills: ['runCommand'], approvalMode: 'deny' }],
    }), 'utf8');

    const wrapped = wrapWithGate(highRiskSkill);
    const result = await wrapped.handler({ command: 'echo ok' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('ポリシーにより拒否');
  });
});
