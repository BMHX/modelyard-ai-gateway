# Auth Strategy

## Finalized approach

The product uses two different authentication surfaces:

- Control plane auth: human operators authenticate to `web-admin` and `control-api`
- Data plane auth: tools authenticate to `gateway`

These must stay separate.

## Control plane

### Production target

- Identity source: external OIDC provider
- Session model: short-lived app session after OIDC login
- Authorization model: roles stored in the local `members` table
- Enforcement point: `control-api`

The expanded target design for enterprise evaluation lives in [Enterprise Identity Mainline](./ENTERPRISE_IDENTITY_MAINLINE.md).

Why this is the finalized direction:

- avoids building and securing a custom password system
- works for SaaS and enterprise SSO expansion
- maps cleanly onto the existing `members.role` model
- keeps `web-admin` stateless and replaceable

### V1 / pilot bootstrap mode

Until OIDC is implemented, the repo now supports an operator bootstrap token:

- env var: `CONTROL_API_ADMIN_TOKEN`
- transport: `Authorization: Bearer <token>`
- scope: all `/v1/*` Control API routes

This is intentionally a bring-up and self-host bootstrap mechanism, not the long-term human login UX.

### Current bridge mode

The repo now also supports a lightweight member-scoped bridge for control-plane reads and workspace-scoped operations:

- transport: `x-member-email: member@example.com`
- lookup: `control-api` resolves the workspace member from the local `members` table
- authorization: permissions are derived from `members.role`

This is still a bootstrap path, not the final browser session model, but it lets us exercise real workspace RBAC before OIDC lands.

## Enterprise identity mainline

The current missing pieces are no longer just "login" work. They are a single enterprise control-plane hardening track:

- standards-based OIDC / SSO integration
- application session issuance and revocation
- consistent org / workspace / project RBAC enforcement
- audit coverage for auth lifecycle and denied access events
- SCIM-ready external identity mapping

These should be built as parallel workstreams with one shared target state, not as isolated feature tickets.

## Data plane

The gateway does not use human login. It authenticates requests with virtual keys.

- client sends `Authorization: Bearer teamops_vk_...`
- gateway resolves the hashed key
- workspace/provider/budget policy is looked up from the virtual key scope
- upstream provider keys remain hidden

This is the long-term product model and should remain the default even after SSO is added to the control plane.

## Role model

Current default roles:

- `organization_owner`
- `workspace_admin`
- `project_maintainer`
- `developer`
- `finance_viewer`

Recommended V1 enforcement split:

- `organization_owner`: org-level setup, billing, exports, member admin
- `workspace_admin`: provider connections, virtual keys, budgets, alerts
- `project_maintainer`: project/env scoped controls, limited to explicitly assigned projects
- `developer`: read project, environment, usage, and key data scoped to explicitly assigned projects
- `finance_viewer`: read budgets, usage, alerts, and exports, with project-scoped views filtered by explicit project assignments when configured

## Roadmap

### V1

- bootstrap admin token for Control API
- role mapping through `members`
- gateway virtual-key auth

### V2

- real OIDC login for `web-admin`
- server-side session handling owned by `control-api`
- consistent organization / workspace / project RBAC enforcement
- auth lifecycle audit coverage

### V3

- enterprise SSO configuration depth
- SCIM provisioning and mapping
- tenant-level auth policies
- self-host identity integration guides

## Non-goals for now

- custom username/password auth
- exposing raw provider keys to end users
- sharing one auth model between admin users and gateway callers
