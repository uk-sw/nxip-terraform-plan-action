import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePlan } from '../src/planParser.js';
import type { TerraformPlan } from '../src/types.js';

async function loadFixture(name: string): Promise<TerraformPlan> {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as TerraformPlan;
}

describe('parsePlan', () => {
  it('previews a plain create, ignores non-nxip_subnet resources, and omits the Computed parent_subnet_id rather than skipping', async () => {
    const plan = await loadFixture('plan-create-only');
    const result = parsePlan(plan);

    expect(result.previewable).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.deletions).toHaveLength(0);

    const [resource] = result.previewable;
    expect(resource?.address).toBe('nxip_subnet.team_a');
    expect(resource?.body).toEqual({
      family: 'IPV4',
      prefixLength: 24,
      environment: 'production',
      region: 'us-east-1',
      name: 'team-a',
      description: 'App Team A',
      metadata: { cost_center: 'eng-42' },
    });
    // parent_subnet_id is Computed-and-unset here (auto-resolution),
    // not a cross-resource dependency - must not appear in the body.
    expect(resource?.body.parentSubnetId).toBeUndefined();
  });

  it('previews a replace (delete-then-create) using the after values', async () => {
    const plan = await loadFixture('plan-replace');
    const result = parsePlan(plan);

    expect(result.previewable).toHaveLength(1);
    expect(result.previewable[0]?.body.prefixLength).toBe(25);
  });

  it('lists a pure delete in deletions, with nothing previewed', async () => {
    const plan = await loadFixture('plan-delete-only');
    const result = parsePlan(plan);

    expect(result.previewable).toHaveLength(0);
    expect(result.deletions).toEqual([{ address: 'nxip_subnet.decommissioned' }]);
  });

  it('skips a genuinely unresolved cross-resource dependency, but not the common no-explicit-parent nesting case', async () => {
    const plan = await loadFixture('plan-unknown-parent-dependency');
    const result = parsePlan(plan);

    // region_us_east_1: fully known top-level create - previewable.
    // team_c: parent_subnet_id references an unresolved sibling's id,
    // and environment/region are also unset - routing cannot be
    // resolved at all, so this is the one case that must skip.
    // team_d: family itself unknown (Required field) - unambiguous skip.
    expect(result.previewable.map((r) => r.address)).toEqual(['nxip_subnet.region_us_east_1']);
    expect(result.skipped).toHaveLength(2);

    const teamC = result.skipped.find((s) => s.address === 'nxip_subnet.team_c');
    expect(teamC?.reason).toContain('Routing');

    const teamD = result.skipped.find((s) => s.address === 'nxip_subnet.team_d');
    expect(teamD?.reason).toContain('`family`');
  });
});
