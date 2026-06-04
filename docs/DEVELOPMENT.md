# Development Setup

## Workspace layout

- `apps/web-admin`: admin console
- `apps/control-api`: control plane service
- `apps/export-worker`: background export worker
- `apps/gateway`: gateway/data plane service
- `packages/contracts`: shared request/response schemas
- `packages/config`: shared env parsing
- `packages/database`: db helpers and SQL migrations
- `packages/export-jobs`: shared export generation and worker logic

## Local dependencies

- PostgreSQL
- Valkey

## Local env

Copy `.env.development.example` to `.env.development`, then validate it:

```bash
npm run env:check
```

Development commands load `.env.development.local` first, then `.env.development`.

## Database services

Bring them up with:

```bash
npm run db:up
```

`npm run db:up` automatically selects `docker compose` or `docker-compose`.
If Docker is configured to use Colima and the daemon is stopped, it will start Colima first.

## Start services

In separate terminals:

```bash
npm run dev:control-api
npm run dev:export-worker
npm run dev:gateway
npm run dev:web-admin
```

Or use one command for the full local development stack:

```bash
npm run dev:stack
```

Use this variant if you want it to seed the pilot demo before starting the services:

```bash
npm run dev:stack:seed
```

`dev:stack` runs `env:check`, `db:up`, and `db:migrate` first, then starts the four services with prefixed logs. Stop it with `Ctrl+C`. Database containers keep running until you call `npm run db:down`.

## Apply database migrations

```bash
npm run db:migrate
```

## Seed the pilot demo

```bash
npm run demo:seed
```

This also refreshes `.demo/demo-state.json` and `.demo/demo-brief.md`.

Reset and reseed if you want a clean demo tenant:

```bash
npm run demo:reset
npm run demo:seed
```

Run the demo smoke checks after starting the services:

```bash
npm run demo:smoke
```

## Notes

- `npm run dev` is the development entrypoint.
- Root `npm start` now runs the production admin stack, not `next dev`.
- New product development should happen inside `apps/` and `packages/`.
- `CONTROL_API_ADMIN_TOKEN` is the bootstrap auth token for the Control API in local/demo environments.
- `CONTROL_API_MEMBER_EMAIL` lets `web-admin` call the Control API as a specific workspace member when you are testing member-scoped RBAC without a full login system.
- `DEMO_MODE=1` lets the gateway return synthetic completions for seeded virtual keys.
- `npm run demo:seed` creates demo-only provider connections that include placeholder upstream credentials such as `demo-openai-key`. Do not promote seeded provider connections into preview, pilot, or customer-facing environments.
- Export jobs stay `pending` until `export-worker` is running and claims them.
- If `control-api` and `export-worker` run in separate containers, point both at the same `EXPORT_JOBS_DIR` so completed files can be downloaded.
- `export-worker` will automatically re-queue stale `running` jobs and prune orphaned local export files; tune that with `EXPORT_JOB_STALE_AFTER_MS` and `EXPORT_JOB_CLEANUP_INTERVAL_MS` when needed.
