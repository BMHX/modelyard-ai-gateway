# Cloud and Self-host Preview Boundaries

## Product boundary

The product should be sold as Cloud first.

Hybrid and Self-host Preview are important, but they are not the default V1 delivery promise.

Use [Delivery Matrix](./DELIVERY_MATRIX.md) when a customer or teammate needs the precise support and responsibility split.

Operational details for the preview path now live in:

- [Self-Host Preview Install Guide](./SELF_HOST_PREVIEW_INSTALL.md)
- [Hybrid Architecture and Operations](./HYBRID_OPERATIONS.md)
- [Upgrade and Rollback Runbook](./UPGRADE_ROLLBACK_RUNBOOK.md)
- [Environment Matrix](./ENV_MATRIX.md)

## Cloud

### What we support now

- hosted control plane
- hosted gateway
- BYOK provider connections
- virtual keys
- budgets, alerts, usage, exports, audit logs
- pilot demo environments

### Best fit

- startups
- agencies
- platform teams
- customers who want fast onboarding over infra ownership

## Hybrid

### Target shape

- hosted control plane
- customer-operated gateway and/or data plane
- customer-managed provider routing path

### Current status

- architecture direction is defined
- not yet a standard product SKU

## Self-host Preview

### What we can say today

- the repo now has a bootstrap admin-token auth mode
- local, demo, and preview runtime bring-up are documented
- upgrade, rollback, health checks, and env parameters are documented for preview installs
- this is enough for internal testing and qualified enterprise pilot validation

### What is not yet standard

- full enterprise installer
- SSO / SCIM integration pack
- product-native customer-managed KMS integration
- GA-grade support SLA

## Recommended customer-facing language

- Standard offer: Cloud
- Qualified preview: Self-host Preview for customers who need earlier infrastructure validation
- Roadmap: Hybrid and harder enterprise packaging after pilot validation

## Internal rule

Do not sell Self-host Preview as "ready by default" until these are complete:

- OIDC/SSO login plus server-side session handling for the control plane
- org / workspace / project RBAC enforcement
- audit coverage for auth and access-denied events
- SCIM-ready identity mapping seam
- native customer-managed KMS feature
- GA installer and release channel
- edition matrix for support, security, and data responsibilities
