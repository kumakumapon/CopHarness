import type { SkillDefinition } from '../skill';
import { createApprovalRequest, waitForApproval } from './store';
import { getSkillExecutionContext, updateSkillExecutionContext } from '../skills/executionContext';
import { evaluateToolPolicy } from '../toolPolicy/policy';
import { grantSessionPermission } from '../toolPolicy/sessionPermissions';
import { buildDryRunPreview, formatDryRunPreview } from '../toolPolicy/dryRun';

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const GATED_MARKER = '__hilGated';

export function isHilEnabled(): boolean {
  return process.env.HIL_ENABLED === 'true' || process.env.HIL_ENABLED === '1';
}

export function wrapWithGate(skill: SkillDefinition): SkillDefinition {
  // Prevent double-wrapping
  if ((skill as unknown as Record<string, unknown>)[GATED_MARKER]) return skill;

  const timeoutMs =
    Number(process.env.HIL_APPROVAL_TIMEOUT_MS) || DEFAULT_APPROVAL_TIMEOUT_MS;

  const gated: SkillDefinition = {
    ...skill,
    handler: async (args) => {
      const policy = evaluateToolPolicy(skill, args);
      updateSkillExecutionContext({ policyDecision: policy.decision });

      if (policy.decision === 'denied') {
        return { content: `スキル "${skill.name}" の実行はポリシーにより拒否されました。${policy.ruleId ? ` (rule=${policy.ruleId})` : ''}`, isError: true };
      }

      if (policy.decision === 'dry_run_allowed') {
        const preview = await buildDryRunPreview(skill, args);
        updateSkillExecutionContext({ policyDecision: 'dry_run_allowed' });
        return { content: formatDryRunPreview(preview), isError: !preview.available };
      }

      if (policy.decision !== 'approval_required') {
        return skill.handler(args);
      }

      const context = getSkillExecutionContext();
      const preview = await buildDryRunPreview(skill, args);
      const req = createApprovalRequest(skill.name, args, context?.personId ?? context?.channelKey, policy.ruleId, preview);
      updateSkillExecutionContext({ approvalId: req.id, policyDecision: 'approval_required' });
      console.info(`[HIL] Awaiting approval for "${skill.name}" (id=${req.id})`);

      const status = await waitForApproval(req.id, timeoutMs);

      updateSkillExecutionContext({
        approvalStatus: status,
        policyDecision: status === 'approved' ? 'approval_approved' : `approval_${status}`,
      });

      if (status === 'approved') {
        console.info(`[HIL] Approved "${skill.name}" (id=${req.id})`);
        if (policy.mode === 'allowForSession' && context?.personId) {
          grantSessionPermission(context.personId, skill.name, { ruleId: policy.ruleId });
          console.info(`[HIL] Session permission granted for "${skill.name}" (person=${context.personId})`);
        }
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
  return skills.map((s) => wrapWithGate(s));
}
