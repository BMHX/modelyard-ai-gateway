# Private Model Governance One-Pager

## Bring Private Models Under The Same Control Plane

Private model support should be positioned as `private model governance`, not as a disconnected custom integration.

The message is simple:

The same control plane that governs hosted provider APIs can also govern customer-owned gateways, internal model clusters, and OpenAI-compatible private endpoints.

## What "private model governance" means

The product can represent private model access through:

- custom OpenAI-compatible endpoints
- customer-managed gateways
- internal model clusters
- VPC or on-prem inference services

These routes can sit behind a customer boundary while operators still manage access, routing, budgets, and evidence through one shared control plane.

## Why this matters

Enterprise buyers do not want two separate operating models:

- one workflow for public APIs
- another workflow for private or regulated model traffic

They want one consistent system for:

- access control
- route selection
- budget policy
- usage visibility
- audit evidence
- project and environment separation

## Product story

### Public provider route

Use hosted Anthropic or OpenAI-compatible APIs when teams want fast onboarding and managed operations.

### Customer gateway route

Use a customer-managed gateway when the buyer needs traffic or credentials to stay inside their network boundary while still using the hosted control plane for governance.

### Private model lane

Use custom endpoints to represent customer-owned model infrastructure without changing the operator workflow.

## Operational benefits

- One operator console across public and private model routes
- One policy surface for virtual keys, budgets, projects, and environments
- One usage and export model for governance and reporting
- Clearer enterprise story for regulated and infrastructure-heavy accounts

## Sales language

- `We can govern hosted APIs, customer gateways, and private model lanes through one control plane.`
- `Private model access does not require a separate admin workflow.`
- `The product standardizes access and governance even when model traffic stays behind a customer boundary.`

## Promise boundary

Do not imply:

- that every private model deployment pattern already ships with a hardened enterprise installer
- that every on-prem topology is productized as a standard SKU
- that private model governance means full air-gapped support is GA today

The right promise is:

We can represent and govern private model routes now, while broader enterprise packaging and self-host hardening continue to mature.

## Short pitch

Private model access can be brought under the same governed routing plane as public AI providers, so enterprise teams do not need separate tooling for private endpoints, customer gateways, and hosted APIs.
