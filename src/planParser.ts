import { TERRAFORM_RESOURCE_TYPE, REQUIRED_TERRAFORM_FIELDS } from './fieldMapping.js';
import type {
  DeletionResource,
  NxipSubnetBody,
  ParsedPlan,
  PreviewableResource,
  ResourceChange,
  SkippedResource,
  TerraformPlan,
} from './types.js';

function isUnknown(afterUnknown: Record<string, unknown>, field: string): boolean {
  return afterUnknown[field] === true;
}

function knownString(after: Record<string, unknown>, afterUnknown: Record<string, unknown>, field: string): string | undefined {
  if (isUnknown(afterUnknown, field)) return undefined;
  const value = after[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Builds the preview request body for one nxip_subnet create, or returns
 * a skip reason if the resource's routing genuinely can't be resolved
 * from this plan alone.
 *
 * family/prefix_length are Required in the provider schema, so an
 * unknown value there is unambiguous: it can only come from a config
 * expression referencing another resource's not-yet-known attribute.
 * environment/region/parent_subnet_id are Optional+Computed - unknown
 * there is the *normal* state for a field simply left unset in config
 * (the provider fills it in), not just for a genuine cross-resource
 * reference. So instead of skipping on any of those being unknown, this
 * mirrors resource_subnet.go's own Create(): include a routing field
 * only when it's known and non-null, then check whether what's left
 * still satisfies the API's own requirement (parentSubnetId, or both
 * environment and region). Only skip when neither holds - that's the
 * one case that's genuinely unresolvable from this plan.
 */
export function buildPreviewBody(
  after: Record<string, unknown>,
  afterUnknown: Record<string, unknown>
): { ok: true; body: NxipSubnetBody } | { ok: false; reason: string } {
  for (const field of REQUIRED_TERRAFORM_FIELDS) {
    if (isUnknown(afterUnknown, field)) {
      return { ok: false, reason: `\`${field}\` depends on another resource in this plan.` };
    }
  }

  const family = after.family;
  if (family !== 'IPV4' && family !== 'IPV6') {
    return { ok: false, reason: '`family` is missing or not IPV4/IPV6.' };
  }

  const body: NxipSubnetBody = { family };

  const prefixLength = after.prefix_length;
  if (typeof prefixLength === 'number') {
    body.prefixLength = prefixLength;
  }

  const parentSubnetId = knownString(after, afterUnknown, 'parent_subnet_id');
  const environment = knownString(after, afterUnknown, 'environment');
  const region = knownString(after, afterUnknown, 'region');

  const routable = parentSubnetId !== undefined || (environment !== undefined && region !== undefined);
  if (!routable) {
    return {
      ok: false,
      reason:
        'Routing (`parent_subnet_id`, or `environment` + `region`) depends on another resource in this plan.',
    };
  }

  if (parentSubnetId !== undefined) body.parentSubnetId = parentSubnetId;
  if (environment !== undefined) body.environment = environment;
  if (region !== undefined) body.region = region;

  const kind = knownString(after, afterUnknown, 'kind');
  if (kind !== undefined) body.kind = kind;

  const name = knownString(after, afterUnknown, 'name');
  if (name !== undefined) body.name = name;

  const description = knownString(after, afterUnknown, 'description');
  if (description !== undefined) body.description = description;

  if (!isUnknown(afterUnknown, 'metadata')) {
    const metadata = after.metadata;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      body.metadata = metadata as Record<string, string>;
    }
  }

  return { ok: true, body };
}

export function parsePlan(plan: TerraformPlan): ParsedPlan {
  const previewable: PreviewableResource[] = [];
  const skipped: SkippedResource[] = [];
  const deletions: DeletionResource[] = [];

  for (const rc of plan.resource_changes ?? []) {
    if (rc.type !== TERRAFORM_RESOURCE_TYPE) continue;
    handleResourceChange(rc, previewable, skipped, deletions);
  }

  return { previewable, skipped, deletions };
}

function handleResourceChange(
  rc: ResourceChange,
  previewable: PreviewableResource[],
  skipped: SkippedResource[],
  deletions: DeletionResource[]
): void {
  const { actions } = rc.change;

  if (actions.length === 1 && actions[0] === 'delete') {
    deletions.push({ address: rc.address });
    return;
  }

  if (!actions.includes('create')) return; // no-op, read, etc: nothing to preview

  const after = rc.change.after ?? {};
  const afterUnknown = rc.change.after_unknown ?? {};
  const result = buildPreviewBody(after, afterUnknown);

  if (!result.ok) {
    skipped.push({ address: rc.address, reason: result.reason });
    return;
  }

  previewable.push({ address: rc.address, body: result.body });
}
