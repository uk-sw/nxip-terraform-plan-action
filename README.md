# nxip Terraform Plan

Comments on a Terraform pull request with the CIDR and IP-space utilization impact nxip would predict for every `nxip_subnet` change, before anyone runs `terraform apply`.

## Why

A plain `terraform plan` can tell you *that* a subnet is being created. It can't tell you *what CIDR it'll get* or *how full that leaves the pool* - `nxip_subnet` allocates dynamically, and only [nxip](https://nxip.dev) knows the current state of everyone's allocations. This action calls nxip's dry-run `POST /v1/subnets/preview` endpoint for each `nxip_subnet` create in your plan and posts the answer as a PR comment.

This is a GitHub Action, not an extension of [terraform-provider-nxip](https://registry.terraform.io/providers/uk-sw/nxip) - it doesn't run Terraform or touch your cloud credentials. It reads the *output* of a plan written with that provider and calls the nxip API directly.

## Usage

```yaml
name: nxip plan preview

on:
  pull_request:
    paths:
      - "**.tf"

permissions:
  contents: read
  pull-requests: write

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3

      - run: terraform init
      - run: terraform plan -out=tfplan
      - run: terraform show -json tfplan > plan.json

      - uses: uk-sw/nxip-terraform-plan-action@v1
        with:
          plan-json-path: plan.json
          nxip-api-key: ${{ secrets.NXIP_API_KEY }}
```

If `NXIP_API_KEY` (and optionally `NXIP_URL`) are already exported as environment variables for the provider itself, `nxip-api-key` can be omitted - this action falls back to the same environment variables terraform-provider-nxip does.

### A real example

Grounded in [`nxip-terraform-lab`](https://github.com/uk-sw)'s dogfood config: a team subnet that auto-resolves onto a `kind`-tagged region block rather than a pool directly.

```hcl
resource "nxip_subnet" "payments_production" {
  environment   = nxip_subnet.production_us_east_region.environment
  region        = nxip_subnet.production_us_east_region.region
  family        = nxip_subnet.production_us_east_region.family
  prefix_length = 24
  name          = "Payments team"
}
```

The resulting comment shows the predicted CIDR and the *region block's* utilization before and after - not the pool's, which wouldn't move at all for a nested placement like this one.

| Resource | Status | CIDR | Destination | Utilization |
|---|---|---|---|---|
| `nxip_subnet.payments_production` | ✅ | `10.101.16.0/24` | subnet `us-east-1 region block` | 12% → 18% |

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `plan-json-path` | yes | | Path to a JSON plan from `terraform show -json tfplan > plan.json`. This action never runs `terraform` itself. |
| `nxip-api-key` | no | `$NXIP_API_KEY` | nxip API key. Any role works - previewing is a read, not a write. |
| `nxip-url` | no | `$NXIP_URL`, then `https://nxip.dev` | Base URL of the nxip API. |
| `github-token` | no | `${{ github.token }}` | Used to read and upsert the PR comment. |
| `utilization-warning-threshold` | no | `80` | Percentage-used at which a destination's utilization gets a 🔶 warning marker. 95%+ always gets 🔴. |
| `fail-on-predicted-failure` | no | `false` | Exit non-zero if any previewed resource would fail to apply (pool full, tier limit, etc), in addition to commenting. |

## Outputs

| Name | Description |
|---|---|
| `previewed-count` | Number of resources actually previewed. |
| `would-fail-count` | Number of those that the preview predicted would fail if applied. |

## What gets skipped

Every configurable attribute on `nxip_subnet` is `RequiresReplace` (subnets are immutable server-side), so a plan only ever shows `create` or `delete`-then-`create` for this resource - never a plain update. Both are previewed using the plan's `after` values.

A resource is **skipped**, not previewed, only when its routing genuinely can't be resolved from the plan - `family` or `prefix_length` reference another resource still being created in the same plan, or `parent_subnet_id` does *and* no `environment`/`region` are set either. This is intentionally narrow: `environment`/`region`/`parent_subnet_id` are `Optional+Computed` in the provider schema, so they show as "unknown" in the plan any time they're simply left unset in config too - which is the normal, common case for an auto-resolving subnet that never sets `parent_subnet_id` at all. Skipping on that would defeat the point of this action for its most common use case, so it isn't treated as a blocker - only a genuinely unresolved reference is.

The one case this does skip in practice: nesting a subnet under a *sibling that's being created in the same PR* (e.g. `payments_production_az_a`'s `parent_subnet_id = nxip_subnet.payments_production.id`, when `payments_production` doesn't exist yet either) - its `id` truly can't be known until apply. Once the parent exists, later PRs referencing it preview normally.

Delete-only resources are listed in a collapsed section with no utilization impact computed for them in this version.

## Limitations

A preview is not a reservation. Nothing is locked when you call `/v1/subnets/preview`, so a concurrent preview or a real `apply` against the same pool or subnet can land on a different CIDR than what was shown. For a replace (destroy-then-create), the preview runs before the old block is actually freed, so the real apply-time allocation may differ from the prediction. Every comment states this explicitly.

## Security

**Do not** trigger this action on `pull_request_target` with a plan built from the PR's own branch. `pull_request_target` runs with the base repo's secrets - including `NXIP_API_KEY` - against code from the fork, which would hand a fork PR author your API key. Use `pull_request` (as in the example above), which runs with the fork's own, secret-less context.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build   # regenerates dist/index.js - commit the result
```

`dist/index.js` is committed because the Actions runtime executes it directly, with no install or build step. CI fails if `dist/` doesn't match a fresh build of `src/`.
