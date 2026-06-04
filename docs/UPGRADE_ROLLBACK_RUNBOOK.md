# Upgrade and Rollback Runbook

This runbook is the minimum supported process for Hybrid and Self-host Preview environments.

## Version Policy

- Upgrade between adjacent tagged preview releases only.
- Keep the previous image digest, source tag, and database backup until the new release is validated.
- Do not combine schema upgrades with secret rotation or topology changes in the same maintenance window.

## Before You Start

- Confirm a fresh Postgres backup exists.
- Confirm `preview-export-data` or the equivalent export volume is snapshotted if exports must be preserved.
- Record the currently deployed image digest or git tag.
- Review environment drift against [Environment Matrix](./ENV_MATRIX.md).
- Announce a maintenance window for any customer-facing environment.

## Upgrade Steps

1. Pull or check out the target release.
2. Review release notes and schema changes.
3. Update secrets and environment parameters only if the release explicitly requires them.
4. Build the new runtime image with `docker-compose -f infra/docker-compose.preview.yml build`.
5. Run migrations with `docker-compose -f infra/docker-compose.preview.yml run --rm migrate`.
6. Deploy the updated services with `docker-compose -f infra/docker-compose.preview.yml up -d`.
7. Validate health endpoints for `control-api`, `gateway`, `export-worker`, and `web-admin`.
8. Run a smoke flow:
   - sign into `web-admin`
   - load a usage or workspace page
   - send one gateway request through the configured provider path
   - create and download one export
9. Keep the previous image and backup until the environment is stable through one business day of normal usage.

## Rollback Triggers

Rollback if any of these happen after the deploy:

- health checks fail and do not recover quickly
- migrations succeed but the application cannot serve baseline operator flows
- gateway traffic returns persistent 5xx or timeout errors
- export processing stops or corrupts output paths

## Rollback Steps

1. Stop new rollout activity and freeze config changes.
2. Re-deploy the previous known-good image or git tag.
3. If the failed release introduced incompatible schema changes, restore the pre-upgrade database backup before bringing services back.
4. Start services with `docker-compose -f infra/docker-compose.preview.yml up -d`.
5. Re-run the health and smoke validation steps.
6. Capture logs and the failed image digest for postmortem review.

## Post-Upgrade Checks

- verify `GET /healthz` for `control-api` and `gateway`
- verify `GET /api/healthz` for `web-admin`
- verify `GET /healthz` on the export worker health port
- verify new usage events appear in the control plane
- verify one export job completes end to end

## Ownership Boundary

- Customers own execution of upgrades in Self-host Preview.
- We provide release notes, migration guidance, and troubleshooting help within the preview support envelope.
