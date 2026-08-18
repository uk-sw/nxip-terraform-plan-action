// Minimal shape of `terraform show -json`'s output - only the parts this
// action reads. See https://developer.hashicorp.com/terraform/internals/json-format
export interface TerraformPlan {
  resource_changes?: ResourceChange[];
}

export interface ResourceChange {
  address: string;
  type: string;
  name: string;
  change: ResourceChangeDetail;
}

export interface ResourceChangeDetail {
  actions: string[];
  after: Record<string, unknown> | null;
  // Boolean (or, for maps/objects, a nested structure) keyed by attribute
  // name; `true` means the value can't be known until apply. Also true
  // for a Computed attribute that's simply absent from config, not only
  // for one that references an unresolved resource - see planParser.ts.
  after_unknown: Record<string, unknown>;
}

export type AddressFamily = 'IPV4' | 'IPV6';

// The exact request body POST /v1/subnets and POST /v1/subnets/preview
// accept, restricted to what a Terraform plan can ever produce (cidr is
// Computed-only in the provider schema, never sent from config).
export interface NxipSubnetBody {
  family: AddressFamily;
  prefixLength?: number;
  environment?: string;
  region?: string;
  parentSubnetId?: string;
  kind?: string;
  name?: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface PreviewableResource {
  address: string;
  body: NxipSubnetBody;
}

export interface SkippedResource {
  address: string;
  reason: string;
}

export interface DeletionResource {
  address: string;
}

export interface ParsedPlan {
  previewable: PreviewableResource[];
  skipped: SkippedResource[];
  deletions: DeletionResource[];
}

// Mirrors apps/api/src/routes/subnets.ts's previewSubnetSchema response
// exactly - see net-saas-monorepo. Kept as one source of truth here so
// the comment builder can't drift from what the API actually returns.
export type TierLimitMetric = 'subnets' | 'ipv4Addresses';
export type OrgTier = 'FREE' | 'STARTER' | 'TEAM' | 'ENTERPRISE';

export interface PreviewContainer {
  type: 'pool' | 'subnet';
  id: string;
  name: string | null;
  cidr: string;
}

export interface ContainerUtilization {
  subnetCount: number;
  usedAddresses?: number;
  capacity?: number;
  percentageUsed?: number;
}

export interface PreviewSuccess {
  wouldSucceed: true;
  subnet: {
    cidr: string;
    prefixLength: number;
    family: AddressFamily;
    environment: string;
    region: string;
    ipPoolId: string;
    parentSubnetId: string | null;
    kind: string | null;
    name: string | null;
    description: string | null;
    metadata: Record<string, string>;
  };
  container: PreviewContainer;
  utilization: { before: ContainerUtilization; after: ContainerUtilization };
}

export type PreviewFailureReason =
  | 'no-pool'
  | 'parent-not-found'
  | 'parent-family-mismatch'
  | 'kind-conflict'
  | 'full'
  | 'invalid-cidr'
  | 'outside-pool'
  | 'overlaps-existing'
  | 'tier-limit';

export interface PreviewFailure {
  wouldSucceed: false;
  reason: PreviewFailureReason;
  message: string;
  httpStatusIfAttempted: number;
  tierLimit?: {
    metric: TierLimitMetric;
    tier: OrgTier;
    current: number;
    limit: number;
  };
}

export type PreviewResult = PreviewSuccess | PreviewFailure;

// One row's worth of outcome for the comment builder - either a real
// preview result, or a client-side failure (non-200/non-2xx-business
// response) that couldn't even be evaluated.
export interface PreviewOutcome {
  address: string;
  result: PreviewResult;
}

export interface RequestFailure {
  address: string;
  error: string;
}
