# Self-Host Preview Install Guide

This guide is for qualified customer pilots and internal delivery teams. It is not a GA enterprise installer.

## What This Preview Includes

- production-mode runtime packaging via [infra/Dockerfile.runtime](../infra/Dockerfile.runtime)
- a reference compose stack via [infra/docker-compose.preview.yml](../infra/docker-compose.preview.yml)
- documented health checks, upgrade flow, and parameter matrix

## What This Preview Does Not Include

- OIDC, SSO, or SCIM integration pack
- a native customer-managed KMS integration inside the product
- zero-touch installer or cluster operator
- 24x7 formal enterprise support

## KMS and Secret Story

The current preview position is:

- customers store secrets in their own secret manager or vault
- secrets are injected into the runtime as environment variables
- `ENCRYPTION_KEY_BASE64` is customer-generated and customer-rotated
- provider credentials should stay in customer-controlled secret infrastructure

This is sufficient for preview evaluations. It is not the same as shipping a full product-native customer-managed KMS feature.

## Prerequisites

- Docker with `docker-compose` or Docker Compose v2
- one Postgres volume with backup capability
- one Valkey instance or the bundled preview container
- a generated `ENCRYPTION_KEY_BASE64`
- a generated `CONTROL_API_ADMIN_TOKEN`

## Install Steps

1. Copy `.env.production.example` to `.env.production`.
2. Set at least these values:
   - `NODE_ENV=production`
   - `CONTROL_API_ADMIN_TOKEN=<strong random token>`
   - `ENCRYPTION_KEY_BASE64=<generated key>`
   - `POSTGRES_PASSWORD=<strong password>`
   - `DEMO_MODE=0`
3. Validate the production profile with `npm run env:check:prod`.
4. Review the rest of the parameters against [Environment Matrix](./ENV_MATRIX.md).
5. Build and start the preview stack with `npm run preview:up`.
6. Wait for `postgres`, `valkey`, `control-api`, `gateway`, `export-worker`, and `web-admin` to become healthy.
7. Open the web admin on `http://localhost:3001` unless you changed `WEB_ADMIN_PUBLIC_PORT`.

## Validation Checklist

- `GET http://localhost:4001/healthz` unless `CONTROL_API_PUBLIC_PORT` changed
- `GET http://localhost:4002/healthz` unless `GATEWAY_PUBLIC_PORT` changed
- `GET http://localhost:3001/api/healthz` unless `WEB_ADMIN_PUBLIC_PORT` changed
- one successful gateway request through a configured provider
- one successful export job

## Support Envelope

The preview support posture is intentionally narrow:

- customers own infrastructure, backups, runtime patching, and on-call execution
- we support installation guidance, release notes, upgrade guidance, and product troubleshooting during agreed pilot hours
- changes to topology, identity model, or secret architecture should be treated as scoped engagement work during preview

## Version Policy

- keep to adjacent preview release upgrades only
- preserve a rollback image or source tag for every upgrade
- follow [Upgrade and Rollback Runbook](./UPGRADE_ROLLBACK_RUNBOOK.md) for every environment change

## Next Documents

- [Observability Baseline](./OBSERVABILITY_BASELINE.md)
- [Hybrid Architecture and Operations](./HYBRID_OPERATIONS.md)
- [Deployment Guide](./DEPLOYMENT.md)

## Env Loading

- Preview tooling reads `.env.production.local` first, then `.env.production`.
- `docker compose` is invoked with `.env.production`, while `.env.production.local` overrides are injected through the shell environment.
