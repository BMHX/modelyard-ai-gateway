# Enterprise Identity Mainline

This document turns the auth roadmap into an implementation target for enterprise evaluation.

It does not replace [Auth Strategy](./AUTH_STRATEGY.md). It expands the control-plane target so the repo can move from bootstrap demo auth to an enterprise-assessable shape.

## Desired end state

- Human operators sign in with enterprise OIDC / SSO
- `control-api` owns session validation and authorization decisions
- permissions are enforced across organization, workspace, and project scopes
- security-relevant auth and authorization actions are audit logged
- SCIM can provision and map identities without redesigning the membership model

The gateway auth model stays separate and continues to use virtual keys.

## Workstreams To Run In Parallel

### 1. OIDC / SSO integration

Target protocol:

- OIDC Authorization Code flow with PKCE
- external identity provider per organization as the V1 enterprise shape
- standards-first support for Okta, Microsoft Entra ID, Google Workspace, and generic OIDC providers through issuer metadata

Recommended product rules:

- no product-managed passwords
- login subject is anchored on `issuer + subject`
- verified email is required for initial member resolution unless an explicit external identity mapping already exists
- if multiple organizations match the same email, the login flow must force org selection before session issuance

Minimum provider configuration model:

- `organization_id`
- `provider_type`
- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `userinfo_endpoint`
- `jwks_uri`
- `client_id`
- encrypted `client_secret` when confidential clients are used
- optional `domain_hint`
- optional `scopes`
- `status`

## 2. Session model and login flow

Session ownership:

- browser login starts from `web-admin`
- `control-api` is the source of truth for session creation, lookup, refresh, and revocation
- `web-admin` should only forward the operator session to `control-api`; it should not make authorization decisions on its own

Recommended runtime shape:

- browser receives an opaque, httpOnly, secure session cookie
- cookie value is only a random session handle, never raw OIDC tokens
- `control-api` resolves the handle to the stored session record
- upstream OIDC access tokens and refresh tokens stay server-side only

Recommended session record:

- `id`
- `member_id`
- `organization_id`
- `identity_provider_id`
- `external_subject`
- `email`
- `amr`
- `issued_at`
- `last_seen_at`
- `expires_at`
- `idle_expires_at`
- `revoked_at`
- `ip_address`
- `user_agent`
- `impersonated_by_member_id` nullable for future support tooling

Recommended login flow:

1. User starts login from organization-aware entrypoint
2. Product redirects to the configured OIDC provider with `state`, `nonce`, and PKCE challenge
3. Callback exchanges the auth code and validates issuer, audience, nonce, and token freshness
4. Product resolves or creates the external identity mapping
5. Product resolves the local member record and effective org/workspace access
6. Product writes an application session and sets the session cookie
7. `web-admin` uses that session on every subsequent `control-api` request

Recommended session security rules:

- short idle timeout
- bounded absolute lifetime
- rotate session handle on login and privileged identity changes
- revoke all active sessions when membership is disabled
- revoke all active sessions when the linked external identity mapping is removed

## 3. Three-level RBAC enforcement

Current role names can stay, but enforcement needs a consistent scope ladder:

- organization: org settings, identity provider setup, billing, exports, member governance
- workspace: providers, virtual keys, budgets, alerts, reports, workspace settings
- project: project metadata, environments, project-scoped budgets, project-scoped key access, filtered usage views

Required evaluation order for every control-plane route:

1. authenticate session
2. resolve organization access
3. resolve workspace access within that organization when a workspace-scoped resource is touched
4. resolve assigned project scope when the role uses project assignments
5. apply action permission check

Enforcement rules:

- organization routes must stop relying on bootstrap-admin-only semantics for normal operators
- workspace listing must be filtered by org membership first, then workspace membership
- project assignment roles must never gain broad workspace write access through list or detail endpoints
- write routes must validate both resource ownership and scoped permission before mutation
- read routes for audit, exports, budgets, alerts, usage, and keys must filter results to the effective project set when applicable

## 4. Audit event coverage

The current audit system already captures many successful control-plane mutations. The enterprise gap is coverage of identity and access events.

New event families to add:

- `auth.login.started`
- `auth.login.succeeded`
- `auth.login.failed`
- `auth.logout.completed`
- `auth.session.revoked`
- `auth.session.expired`
- `auth.identity-linked`
- `auth.identity-unlinked`
- `auth.access.denied`
- `auth.role-escalation-attempted`
- `auth.provider-configured`
- `auth.provider-updated`
- `auth.provider-disabled`
- `scim.provisioning-succeeded`
- `scim.provisioning-failed`
- `scim.group-mapping-updated`

Coverage rules:

- successful and denied privileged actions should both be logged
- session lifecycle changes must be attributable to a human or system actor
- identity-provider configuration changes are always auditable at organization scope
- member lifecycle changes triggered by SCIM must include provider metadata in the audit payload

## 5. SCIM mapping seam

SCIM does not need to ship in the same milestone as OIDC login, but the data model should stop assuming email-only joins.

Interfaces to reserve now:

- external identity mapping: `issuer + subject -> member`
- optional external group mapping: external group id -> product role and optional workspace/project scope
- provisioning source metadata on members
- deprovision policy that can disable membership and revoke sessions without deleting historical audit state

V1 SCIM scope:

- create or update member
- disable member
- manage role
- manage workspace membership
- manage project assignment set for scoped roles

Out of scope for V1:

- nested group expansion inside the product
- customer-specific policy engines
- Just-In-Time role elevation outside explicit mappings

## Suggested data model additions

These are design targets, not a required migration order:

- `identity_providers`
- `external_identities`
- `control_plane_sessions`
- `session_revocations`
- `scim_directory_links`
- `scim_group_mappings`

The existing `members` and `member_project_assignments` tables remain central. The new tables should attach to them instead of replacing them.

## Bootstrap coexistence plan

Until the full session model ships:

- keep `CONTROL_API_ADMIN_TOKEN` for bring-up and break-glass access
- keep `x-member-email` only as a temporary bridge for local testing and self-host bootstrap flows
- do not build new product UX on top of the member-email header path

Exit criteria for removing the browser-facing bridge:

- OIDC login works for at least one enterprise IdP
- session-backed `web-admin` requests reach `control-api`
- organization/workspace/project enforcement is unified
- audit coverage includes auth lifecycle and denied access events

## Delivery gates

The product should be considered enterprise-evaluable when all of the following are true:

- enterprise OIDC login is working
- session revocation and expiry are enforced server-side
- RBAC is consistent across organization, workspace, and project routes
- audit logs cover auth and authorization events, not only data mutations
- SCIM mapping seams exist in the data model and API boundaries
