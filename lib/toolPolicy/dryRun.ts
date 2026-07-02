import type { SkillDefinition, SkillDryRunPreview } from '../skill';
import { redactPreviewText, redactPreviewValue } from './redaction';

export type ApprovalPreview = SkillDryRunPreview & {
  generatedAt: number;
  available: boolean;
};

export async function buildDryRunPreview(
  skill: SkillDefinition,
  args: Record<string, unknown>,
): Promise<ApprovalPreview> {
  if (!skill.dryRun) {
    return {
      summary: `No dry-run preview is available for ${skill.name}.`,
      unavailableReason: 'Skill does not implement dryRun preview generation.',
      generatedAt: Date.now(),
      available: false,
      details: redactPreviewValue(args) as Record<string, unknown>,
    };
  }

  try {
    const preview = await skill.dryRun(args);
    return redactPreview(preview, true);
  } catch (err) {
    return {
      summary: `Could not generate dry-run preview for ${skill.name}.`,
      unavailableReason: err instanceof Error ? err.message : String(err),
      generatedAt: Date.now(),
      available: false,
    };
  }
}

function redactPreview(preview: SkillDryRunPreview, available: boolean): ApprovalPreview {
  return {
    ...preview,
    summary: redactPreviewText(preview.summary),
    diff: preview.diff ? redactPreviewText(preview.diff) : undefined,
    command: preview.command ? redactPreviewText(preview.command) : undefined,
    details: preview.details ? redactPreviewValue(preview.details) as Record<string, unknown> : undefined,
    targets: preview.targets?.map(redactPreviewText),
    externalDestinations: preview.externalDestinations?.map(redactPreviewText),
    riskAttributes: preview.riskAttributes?.map(redactPreviewText),
    unavailableReason: preview.unavailableReason ? redactPreviewText(preview.unavailableReason) : undefined,
    generatedAt: Date.now(),
    available,
  };
}

export function formatDryRunPreview(preview: ApprovalPreview): string {
  const lines = [`Dry-run preview: ${preview.summary}`];
  if (preview.command) lines.push(`Command: ${preview.command}`);
  if (preview.targets?.length) lines.push(`Targets: ${preview.targets.join(', ')}`);
  if (preview.externalDestinations?.length) lines.push(`External destinations: ${preview.externalDestinations.join(', ')}`);
  if (preview.riskAttributes?.length) lines.push(`Risk attributes: ${preview.riskAttributes.join(', ')}`);
  if (preview.unavailableReason) lines.push(`Unavailable reason: ${preview.unavailableReason}`);
  if (preview.diff) lines.push(`Diff:\n${preview.diff}`);
  if (preview.details) lines.push(`Details:\n${JSON.stringify(preview.details, null, 2)}`);
  return lines.join('\n');
}
