import type { SkillDefinition } from '../skill';
import { createApprovalRequest, waitForApproval } from './store';
import { getSkillExecutionContext, updateSkillExecutionContext } from '../skills/executionContext';

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const GATED_MARKER = '__hilGated';

export function isHilEnabled(): boolean {
  return process.env.HIL_ENABLED === 'true' || process.env.HIL_ENABLED === '1';
}

export function wrapWithGate(skill: SkillDefinition): SkillDefinition {
  // Prevent double-wrapping
  if ((skill as unknown as Record<string, unknown>)[GATED_MARKER]) return skill;
  if (!isHilEnabled() || skill.riskLevel !== 'high') return skill;

  const timeoutMs =
    Number(process.env.HIL_APPROVAL_TIMEOUT_MS) || DEFAULT_APPROVAL_TIMEOUT_MS;

  const gated: SkillDefinition = {
    ...skill,
    handler: async (args) => {
      const context = getSkillExecutionContext();
      const req = createApprovalRequest(skill.name, args, context?.personId ?? context?.channelKey);
      updateSkillExecutionContext({ approvalId: req.id });
      console.info(`[HIL] Awaiting approval for "${skill.name}" (id=${req.id})`);

      const status = await waitForApproval(req.id, timeoutMs);

      if (status === 'approved') {
        console.info(`[HIL] Approved "${skill.name}" (id=${req.id})`);
        return skill.handler(args);
      }

      const msg =
        status === 'timeout'
          ? `スキル "${skill.name}" の実行はタイムアウトにより拒否されました。`
          : `スキル "${skill.name}" の実行は人間によって拒否されました。`;
      return { content: msg, isError: true };
    },
  };

  (gated as unknown as Record<string, unknown>)[GATED_MARKER] = true;
  return gated;
}

export function applyGatesToRegistry(skills: SkillDefinition[]): SkillDefinition[] {
  if (!isHilEnabled()) return skills;
  return skills.map((s) => wrapWithGate(s));
}
