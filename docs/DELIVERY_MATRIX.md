# Delivery Matrix

This matrix is the customer-facing and internal alignment layer for how we package the product.

The short version:

- Standard SKU: Cloud
- Qualified preview: Self-host Preview
- Do not position Self-host Preview as GA until the hardening gates at the bottom are complete

Reference documents:

- [Self-Host Preview Install Guide](./SELF_HOST_PREVIEW_INSTALL.md)
- [Hybrid Architecture and Operations](./HYBRID_OPERATIONS.md)
- [Upgrade and Rollback Runbook](./UPGRADE_ROLLBACK_RUNBOOK.md)
- [Environment Matrix](./ENV_MATRIX.md)
- [Observability Baseline](./OBSERVABILITY_BASELINE.md)

## Delivery Modes

| Area | Cloud (standard) | Hybrid (target shape) | Self-host Preview |
| --- | --- | --- | --- |
| Commercial status | Sell by default | Design target for larger accounts | Validation path only |
| Control plane | Vendor-hosted | Vendor-hosted | Customer-hosted |
| Gateway / data plane | Vendor-hosted | Customer-hosted optional | Customer-hosted |
| Provider credentials | BYOK stored in product control plane | Prefer customer-managed in customer network | Customer-managed |
| Human auth | Product-managed OIDC/session model once implemented | Same as Cloud control plane | Customer identity integration required |
| Upgrades | Vendor-managed | Shared plan per account | Customer-operated with documented preview runbook |
| Support posture | Standard supportable product | Scoped engagement | Defined preview support envelope |
| Best-fit customer | Teams optimizing for speed | Teams needing data-plane isolation | Regulated or infra-heavy evaluations |

## Who Owns What

### Cloud

- We own runtime operations, upgrades, monitoring, and backup posture.
- Customers own provider accounts, workspace configuration, budget policy choices, and member lifecycle inside the product.

### Hybrid

- We own the hosted control plane and shared product behavior.
- Customers own the isolated gateway or routing layer they run in their environment.
- This requires account-specific scoping before sale because the support boundary is split.

### Self-host Preview

- Customers own infra, runtime, upgrade execution, and incident response for their environment.
- We currently provide preview runtime packaging, install guidance, and runbooks, not a fully hardened enterprise installer.

## Sales Language

- Say: "The standard deployment is Cloud with BYOK provider routing and governance controls."
- Say: "We can evaluate Self-host Preview with qualified customers when they need early infrastructure validation."
- Do not say: "Self-host is production-ready by default."
- Do not promise: enterprise installer, SSO/SCIM pack, product-native customer-managed KMS, or GA support guarantees yet.

## Hardening Gates Before GA Self-Host

- enterprise OIDC/SSO login plus server-side session handling for the control plane
- org / workspace / project RBAC enforcement consistency
- audit coverage for auth lifecycle and access-denied events
- SCIM-ready identity mapping seam
- GA-grade runtime packaging and installer distribution
- product-native customer-managed KMS integration
- formal support SLA and enterprise version policy
