# Observability Baseline

This is the minimum operations baseline for Hybrid and Self-host Preview environments.

## Logging

- `control-api` and `gateway` already emit structured Fastify logs to stdout.
- `export-worker` emits stdout and stderr lifecycle logs for job execution, retries, and cleanup.
- `web-admin` should be treated as an application access log source; rely on container logs and reverse-proxy logs for request tracing.
- Forward all container stdout and stderr to the customer's standard log sink before pilot traffic begins.

## Health Checks

Use these endpoints for liveness and readiness checks:

| Service | Endpoint | What it verifies |
| --- | --- | --- |
| `control-api` | `GET /healthz` | Process is up and Postgres is reachable. |
| `gateway` | `GET /healthz` | Process is up and Postgres is reachable. |
| `export-worker` | `GET /healthz` on `EXPORT_WORKER_HEALTH_PORT` | Worker process is up and Postgres is reachable. |
| `web-admin` | `GET /api/healthz` | Next.js app process is up. |
| `postgres` | `pg_isready` | Database accepts connections. |
| `valkey` | `valkey-cli ping` | Queue/cache service is reachable. |

`infra/docker-compose.preview.yml` wires these checks into the preview stack so operators get container-level health status immediately.

## Metrics Story

The preview baseline does not ship a dedicated Prometheus endpoint yet.

Use the following signals before promising a pilot:

- container restart count per service
- `control-api` and `gateway` request latency and status distribution from platform or reverse-proxy metrics
- `gateway` 5xx rate and upstream timeout count from logs
- export backlog, stale job recovery count, and cleanup events from `export-worker` logs
- Postgres CPU, memory, disk, and connection saturation
- Valkey memory pressure and eviction rate

## Recommended Alerts

- `control-api` health check fails for 2 consecutive intervals
- `gateway` health check fails for 2 consecutive intervals
- `export-worker` health check fails or restarts repeatedly
- `web-admin` health check fails after deploy
- Postgres storage utilization crosses 75 percent
- gateway 5xx rate or upstream timeout rate exceeds pilot threshold

## Incident Triage Order

1. Check service health endpoints and container restart history.
2. Confirm Postgres and Valkey health before debugging application code.
3. Review `gateway` and `control-api` logs for auth, provider, or database failures.
4. Review `export-worker` logs for queue stalls or orphaned export cleanup loops.
5. If the issue follows a deploy, use the [Upgrade and Rollback Runbook](./UPGRADE_ROLLBACK_RUNBOOK.md).
