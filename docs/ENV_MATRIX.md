# Environment Matrix

This document is the single reference for deployment parameters across local, demo, Hybrid, and Self-host Preview installs.

Use it together with:

- [Deployment Guide](./DEPLOYMENT.md)
- [Self-Host Preview Install Guide](./SELF_HOST_PREVIEW_INSTALL.md)
- [Upgrade and Rollback Runbook](./UPGRADE_ROLLBACK_RUNBOOK.md)

## Shared

### Profile files

| Profile | File order | Used by |
| --- | --- | --- |
| `development` | `.env.development.local` -> `.env.development` | local `dev*`, `demo*`, local migrations and seed/reset |
| `production` | `.env.production.local` -> `.env.production` | `start:prod:*`, `prod:*`, `preview:*` |
| `test` | `.env.test.local` -> `.env.test` | test-only tooling |

| Variable | Required | Default | Used by | Notes |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | yes | `development` | all services | Set to `production` for preview or customer-facing environments. |
| `DATABASE_URL` | yes | none | `control-api`, `gateway`, `export-worker` | Postgres connection string. |
| `VALKEY_URL` | yes | `redis://127.0.0.1:6379` | `control-api`, `gateway`, `export-worker` | Queue and coordination state. |
| `ENCRYPTION_KEY_BASE64` | yes | none | `control-api`, `gateway`, `export-worker` | Generate and store in a customer-managed secret store. Rotate with a planned maintenance window. Re-enter saved provider credentials after rotation so persisted API keys remain decryptable under the new runtime key. |
| `EXPORT_JOBS_DIR` | conditional | none | `control-api`, `export-worker` | Required when API and worker do not share the same local filesystem. Mount the same path into both services. |

## Control API

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `CONTROL_API_HOST` | yes | `0.0.0.0` | Bind address inside the container or VM. |
| `CONTROL_API_PORT` | yes | `4001` | Internal listen port. |
| `CONTROL_API_ADMIN_TOKEN` | preview yes | none | Bootstrap operator credential. Rotate after first install and keep out of app logs. |

## Gateway

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `GATEWAY_HOST` | yes | `0.0.0.0` | Bind address inside the container or VM. |
| `GATEWAY_PORT` | yes | `4002` | Internal listen port. |
| `GATEWAY_PUBLIC_BASE_URL` | yes | `http://127.0.0.1:4002` | Customer-visible gateway base URL. |
| `DEMO_MODE` | yes | `0` | Use `0` in preview and pilot environments. `1` is only for seeded demo flows. |

Preview, pilot, and customer-facing environments must not keep seeded placeholder provider credentials such as `demo-openai-key` in active provider connections. Replace seeded connections with real BYOK credentials before validating Access, Providers, or gateway model routing flows.

## Web Admin

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `WEB_ADMIN_PORT` | yes | `3001` | Internal listen port for `next start`. |
| `WEB_ADMIN_BASE_URL` | strongly recommended for OIDC | none | External browser origin for OIDC redirect handling and browser-origin checks. Production should use a stable `https://` origin when available. Temporary `https://` tunnel domains such as ngrok can be used for validation, but a stable domain is still preferred for long-lived OIDC setups. |
| `CONTROL_API_BASE_URL` | yes | `http://127.0.0.1:4001` | Internal URL used by the server-side web app. |
| `NEXT_PUBLIC_CONTROL_API_BASE_URL` | yes | `http://127.0.0.1:4001` | Browser-visible API base URL. In preview installs this usually points at the externally routable control API endpoint. |
| `CONTROL_API_ADMIN_TOKEN` | optional | none | Only needed for bootstrap admin mode. |
| `CONTROL_API_MEMBER_EMAIL` | optional | none | Used for member-scoped workflows when bootstrap admin mode is not used. |

## Export Worker

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `EXPORT_JOB_STALE_AFTER_MS` | optional | built-in default | Requeue stale running jobs after worker failure. |
| `EXPORT_JOB_CLEANUP_INTERVAL_MS` | optional | built-in default | Cleanup cadence for orphaned export files. |
| `EXPORT_WORKER_HEALTH_HOST` | preview yes | `0.0.0.0` | Bind address for the worker health endpoint. |
| `EXPORT_WORKER_HEALTH_PORT` | preview yes | `4010` | Health endpoint port used by container liveness checks. |

## Compose Preview Publishing

These variables control the host-port shape of the preview compose stack:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `CONTROL_API_PUBLIC_PORT` | optional | `4001` | Published host port for `control-api`. |
| `GATEWAY_PUBLIC_PORT` | optional | `4002` | Published host port for `gateway`. |
| `WEB_ADMIN_PUBLIC_PORT` | optional | `3001` | Published host port for `web-admin`. Maps to `WEB_ADMIN_PORT`. |
| `POSTGRES_PASSWORD` | preview yes | `teamops` | Replace for any customer-facing environment. |

## Parameter Conventions

- Keep internal service ports fixed unless there is a platform-level collision requirement.
- Publish only `web-admin`, `control-api`, and `gateway` to the host network by default.
- Do not publish Postgres, Valkey, or the export worker health port outside the private deployment network.
- Store secrets in a customer-managed secret manager and inject them as environment variables at runtime.
- Runtime commands do not read root `.env` or `.env.local`.
- Treat profile env files as local bootstrap artifacts only. For Hybrid or preview installs, prefer platform secret injection over committing or distributing local env files.
