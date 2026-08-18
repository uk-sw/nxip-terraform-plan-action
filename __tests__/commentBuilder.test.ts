import { describe, expect, it } from 'vitest';
import { COMMENT_MARKER, buildComment } from '../src/commentBuilder.js';
import type { PreviewOutcome } from '../src/types.js';

function success(overrides: Partial<PreviewOutcome> = {}): PreviewOutcome {
  return {
    address: 'nxip_subnet.team_a',
    result: {
      wouldSucceed: true,
      subnet: {
        cidr: '10.90.0.0/24',
        prefixLength: 24,
        family: 'IPV4',
        environment: 'production',
        region: 'us-east-1',
        ipPoolId: 'pool_1',
        parentSubnetId: 'subnet_region',
        kind: null,
        name: 'team-a',
        description: null,
        metadata: {},
      },
      container: { type: 'subnet', id: 'subnet_region', name: 'us-east-1 region block', cidr: '10.90.0.0/20' },
      utilization: {
        before: { subnetCount: 0, usedAddresses: 0, capacity: 4096, percentageUsed: 0 },
        after: { subnetCount: 1, usedAddresses: 256, capacity: 4096, percentageUsed: 6.25 },
      },
    },
    ...overrides,
  };
}

describe('buildComment', () => {
  it('includes the hidden marker used to find-and-edit the comment later', () => {
    const comment = buildComment({ outcomes: [], skipped: [], deletions: [], utilizationWarningThreshold: 80 });
    expect(comment).toContain(COMMENT_MARKER);
  });

  it('renders a success row with plain (unemphasized) utilization under threshold', () => {
    const comment = buildComment({ outcomes: [success()], skipped: [], deletions: [], utilizationWarningThreshold: 80 });
    expect(comment).toContain('`nxip_subnet.team_a`');
    expect(comment).toContain('`10.90.0.0/24`');
    expect(comment).toContain('subnet `us-east-1 region block`');
    expect(comment).toContain('0% → 6.25%');
    expect(comment).not.toContain('🔶');
    expect(comment).not.toContain('🔴');
  });

  it('flags utilization at or above the warning threshold with 🔶', () => {
    const outcome = success();
    if (outcome.result.wouldSucceed) {
      outcome.result.utilization.after = { subnetCount: 4, usedAddresses: 3400, capacity: 4096, percentageUsed: 83 };
    }
    const comment = buildComment({ outcomes: [outcome], skipped: [], deletions: [], utilizationWarningThreshold: 80 });
    expect(comment).toContain('🔶 **0% → 83%**');
  });

  it('flags utilization at 95%+ as almost full with 🔴', () => {
    const outcome = success();
    if (outcome.result.wouldSucceed) {
      outcome.result.utilization.after = { subnetCount: 4, usedAddresses: 3900, capacity: 4096, percentageUsed: 95.2 };
    }
    const comment = buildComment({ outcomes: [outcome], skipped: [], deletions: [], utilizationWarningThreshold: 80 });
    expect(comment).toContain('🔴 **0% → 95.2% (almost full)**');
  });

  it('renders an IPv6 container by subnet count, not percentage', () => {
    const outcome = success();
    if (outcome.result.wouldSucceed) {
      outcome.result.utilization = { before: { subnetCount: 2 }, after: { subnetCount: 3 } };
    }
    const comment = buildComment({ outcomes: [outcome], skipped: [], deletions: [], utilizationWarningThreshold: 80 });
    expect(comment).toContain('2 → 3 subnets');
  });

  it('renders a failure row with the reason and the API message verbatim', () => {
    const outcome: PreviewOutcome = {
      address: 'nxip_subnet.team_e',
      result: {
        wouldSucceed: false,
        reason: 'full',
        message: 'Pool 10.90.0.0/16 has no available space for a /24 block.',
        httpStatusIfAttempted: 409,
      },
    };
    const comment = buildComment({ outcomes: [outcome], skipped: [], deletions: [], utilizationWarningThreshold: 80 });
    expect(comment).toContain('❌ **full**');
    expect(comment).toContain('Pool 10.90.0.0/16 has no available space for a /24 block.');
  });

  it('includes tier-limit detail for a tier-limit failure', () => {
    const outcome: PreviewOutcome = {
      address: 'nxip_subnet.team_f',
      result: {
        wouldSucceed: false,
        reason: 'tier-limit',
        message: 'Your FREE plan allows up to 10 subnets.',
        httpStatusIfAttempted: 402,
        tierLimit: { metric: 'subnets', tier: 'FREE', current: 10, limit: 10 },
      },
    };
    const comment = buildComment({ outcomes: [outcome], skipped: [], deletions: [], utilizationWarningThreshold: 80 });
    expect(comment).toContain('10/10 subnets, FREE tier');
  });

  it('puts skipped and deletion-only resources in their own collapsible sections', () => {
    const comment = buildComment({
      outcomes: [],
      skipped: [{ address: 'nxip_subnet.team_c', reason: 'Routing depends on another resource in this plan.' }],
      deletions: [{ address: 'nxip_subnet.decommissioned' }],
      utilizationWarningThreshold: 80,
    });
    expect(comment).toContain('<summary>Skipped');
    expect(comment).toContain('nxip_subnet.team_c');
    expect(comment).toContain('<summary>Deletions');
    expect(comment).toContain('nxip_subnet.decommissioned');
  });

  it('says plainly that a preview is not reserved, on every comment', () => {
    const comment = buildComment({ outcomes: [success()], skipped: [], deletions: [], utilizationWarningThreshold: 80 });
    expect(comment).toContain('not reserved');
  });

  it('reports a clean no-op message when there are no nxip_subnet changes at all', () => {
    const comment = buildComment({ outcomes: [], skipped: [], deletions: [], utilizationWarningThreshold: 80 });
    expect(comment).toContain('No `nxip_subnet` changes in this plan.');
  });
});
