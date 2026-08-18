// Field mapping confirmed against terraform-provider-nxip's own
// resource_subnet.go: every configurable attribute is RequiresReplace
// (subnets are immutable server-side), so a plan can only ever show
// create or delete-then-create for this resource, never a plain
// in-place update. `cidr`/`id` are Computed-only and never sent in a
// create request - the provider's own Create() never includes them.
export const TERRAFORM_RESOURCE_TYPE = 'nxip_subnet';

// snake_case Terraform attribute -> camelCase nxip API field. Attributes
// not listed here are name-identical between the two (family, kind,
// name, description, metadata).
export const RENAMED_FIELDS: Record<string, string> = {
  prefix_length: 'prefixLength',
  parent_subnet_id: 'parentSubnetId',
};

// Required: true in the provider schema, never Computed. An unknown
// value here can only come from a config expression referencing another
// resource's not-yet-known attribute - an unambiguous same-plan
// dependency, worth skipping the whole resource for.
export const REQUIRED_TERRAFORM_FIELDS = ['family', 'prefix_length'] as const;

// Optional+Computed in the provider schema: the provider fills these in
// itself when config leaves them unset, so they show as "unknown" in the
// plan both for that entirely normal case (e.g. an auto-resolving
// subnet that never sets parent_subnet_id) and for a genuine forward
// reference to an unresolved sibling resource. The two can't be told
// apart from after_unknown alone - see planParser.ts's routing check,
// which mirrors resource_subnet.go's own Create() logic (only send a
// field when it is non-null and known) rather than treating "unknown"
// here as automatically skip-worthy.
export const ROUTING_TERRAFORM_FIELDS = ['environment', 'region', 'parent_subnet_id'] as const;

// Optional (not Computed): unknown only if config set them to an
// expression that references an unresolved resource. Omitted
// individually rather than treated as skip-worthy, since they never
// affect CIDR allocation or routing.
export const COSMETIC_TERRAFORM_FIELDS = ['kind', 'name', 'description', 'metadata'] as const;

export function toApiFieldName(terraformField: string): string {
  return RENAMED_FIELDS[terraformField] ?? terraformField;
}
