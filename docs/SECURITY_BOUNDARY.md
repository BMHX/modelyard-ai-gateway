# Security Boundary One-Pager

## Security Boundary And Shared Responsibility

This product should be sold with a clear boundary story:

We provide the governance layer for AI access, while deployment mode determines where runtime, traffic, and credential responsibilities sit.

## Security outcomes the product is designed to improve

- reduce distribution of raw provider credentials
- centralize access through virtual keys and governed routes
- separate operator configuration from inference traffic
- make usage and change history auditable
- support project, workspace, and environment boundaries

## Core security model

### Identity and access

- operators configure access through the control plane
- teams consume virtual keys instead of raw upstream keys
- permissions, project scope, and workspace scope define who can use what

### Credential boundary

- customers bring their own provider accounts
- the system governs access to those providers
- storage and runtime ownership vary by deployment mode

### Traffic boundary

- inference traffic flows through the gateway or customer-managed route
- governance metadata, routing policy, and budget enforcement are applied at that layer
- hybrid deployments can keep the data plane inside the customer network while retaining a hosted control plane

### Evidence boundary

- usage events, exports, and audit records provide operational evidence
- teams can show who used what, where spend happened, and what controls were configured

## Shared responsibility by deployment mode

### Cloud

- we operate the control plane and gateway
- customers own provider accounts, internal usage policy, and workspace administration

### Hybrid

- we operate the hosted control plane
- customers can operate the gateway or routing layer inside their environment
- this is the best fit when network or credential boundaries must remain customer-controlled

### Self-host Preview

- customers operate the control plane and gateway in their environment
- customers own runtime operations, upgrades, and incident response for that deployment
- this should be positioned as a qualified preview, not a default production promise

## What we should say

- `The product improves AI access governance by reducing raw key sprawl and centralizing policy, routing, and evidence.`
- `Hybrid is the path when customers need a hosted governance plane with a customer-controlled traffic boundary.`
- `Self-host Preview is for qualified infrastructure validation, not the default support posture.`

## What we should not say

- `No customer responsibility is required.`
- `Every self-host topology is fully productized today.`
- `Security posture is identical across Cloud, Hybrid, and Self-host Preview.`

## Short pitch

The product creates a governed security boundary for AI access. Cloud, Hybrid, and Self-host Preview use the same control model, but they differ in where runtime, traffic, and credential responsibilities are owned.
