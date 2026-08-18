import type { ContainerUtilization, DeletionResource, PreviewContainer, PreviewOutcome, SkippedResource } from './types.js';

export const COMMENT_MARKER = '<!-- nxip-terraform-plan-action -->';

function formatUtilization(before: ContainerUtilization, after: ContainerUtilization, threshold: number): string {
  if (after.percentageUsed === undefined) {
    return `${before.subnetCount} → ${after.subnetCount} subnets`;
  }
  const beforePct = before.percentageUsed ?? 0;
  const afterPct = after.percentageUsed;
  const text = `${beforePct}% → ${afterPct}%`;
  if (afterPct >= 95) return `🔴 **${text} (almost full)**`;
  if (afterPct >= threshold) return `🔶 **${text}**`;
  return text;
}

function formatDestination(container: PreviewContainer): string {
  const label = container.name ?? container.id;
  return `${container.type} \`${label}\``;
}

function buildRow(outcome: PreviewOutcome, threshold: number): string {
  const { address, result } = outcome;
  if (result.wouldSucceed) {
    const destination = formatDestination(result.container);
    const utilization = formatUtilization(result.utilization.before, result.utilization.after, threshold);
    return `| \`${address}\` | ✅ | \`${result.subnet.cidr}\` | ${destination} | ${utilization} |`;
  }

  const detail =
    result.reason === 'tier-limit' && result.tierLimit
      ? `${result.message} (${result.tierLimit.current}/${result.tierLimit.limit} ${result.tierLimit.metric}, ${result.tierLimit.tier} tier)`
      : result.message;

  return `| \`${address}\` | ❌ **${result.reason}** | ${detail} | n/a | n/a |`;
}

function buildSkippedSection(skipped: SkippedResource[]): string {
  if (skipped.length === 0) return '';
  const items = skipped.map((s) => `- \`${s.address}\`: ${s.reason}`).join('\n');
  return `\n<details>\n<summary>Skipped - routing depends on another resource in this plan (${skipped.length})</summary>\n\n${items}\n\n</details>\n`;
}

function buildDeletionsSection(deletions: DeletionResource[]): string {
  if (deletions.length === 0) return '';
  const items = deletions.map((d) => `- \`${d.address}\``).join('\n');
  return `\n<details>\n<summary>Deletions (${deletions.length}) - no utilization impact previewed for these in v1</summary>\n\n${items}\n\n</details>\n`;
}

export interface BuildCommentOptions {
  outcomes: PreviewOutcome[];
  skipped: SkippedResource[];
  deletions: DeletionResource[];
  utilizationWarningThreshold: number;
}

export function buildComment(options: BuildCommentOptions): string {
  const { outcomes, skipped, deletions, utilizationWarningThreshold } = options;

  if (outcomes.length === 0 && skipped.length === 0 && deletions.length === 0) {
    return `${COMMENT_MARKER}\n## nxip Terraform Plan\n\nNo \`nxip_subnet\` changes in this plan.\n`;
  }

  const header = '| Resource | Status | CIDR | Destination | Utilization |\n|---|---|---|---|---|';
  const rows = outcomes.map((outcome) => buildRow(outcome, utilizationWarningThreshold));
  const table = outcomes.length > 0 ? `${header}\n${rows.join('\n')}` : '_No creatable \`nxip_subnet\` resources in this plan._';

  const failureCount = outcomes.filter((o) => !o.result.wouldSucceed).length;
  const summary =
    failureCount > 0
      ? `**${failureCount} of ${outcomes.length}** previewed subnet change${outcomes.length === 1 ? '' : 's'} would fail if applied.`
      : outcomes.length > 0
        ? `All **${outcomes.length}** previewed subnet change${outcomes.length === 1 ? '' : 's'} would succeed.`
        : '';

  return [
    COMMENT_MARKER,
    '## nxip Terraform Plan',
    summary,
    table,
    buildSkippedSection(skipped),
    buildDeletionsSection(deletions),
    '---',
    '_Predictions from nxip are not reserved: nothing is locked, so a concurrent preview or a real apply against the same pool or subnet can land differently. For a replace (destroy-then-create), this preview ran before the old block was actually freed, so real apply-time allocation may differ from what is shown here._',
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');
}
