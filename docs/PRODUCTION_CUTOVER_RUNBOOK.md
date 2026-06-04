# Production Cutover Runbook

This runbook turns the preview runtime stack into the only supported production cutover path for this repo.

## 1. Prepare a clean release

Use a reviewed commit or tag only.

```bash
npm run prod:preflight -- --phase=build
```

If the preflight fails because the worktree is dirty, stop and build from a clean release commit/tag instead of the live working tree.

## 2. Generate production secrets

Generate fresh secrets and store them in your secret manager:

```bash
npm run prod:secrets
```

Start from [infra/.env.preview.production.example](../infra/.env.preview.production.example) for the non-secret runtime values.

## 3. Snapshot the current database

Export a read-only inventory before any destructive change:

```bash
npm run prod:inventory -- --out=ops-output/prod-inventory.json
```

Take a Postgres backup and snapshot the export volume before continuing.

## 4. Revoke placeholder routes and old keys

Disable seeded placeholder providers:

```bash
npm run prod:revoke-placeholder-providers -- --yes --out=ops-output/revoked-placeholder-providers.json
```

Revoke all currently active virtual keys:

```bash
npm run prod:revoke-virtual-keys -- --yes --out=ops-output/revoked-virtual-keys.json
```

## 5. Production deploy preflight

With production secrets loaded into the environment, run:

```bash
npm run prod:preflight
```

This blocks deploys when any of these remain true:

- demo mode is still enabled
- demo admin token or example encryption keys are still configured
- preview public URLs still point to localhost
- non-docker processes still occupy published ports
- active provider connections still use placeholder upstream credentials

Warnings are still emitted for demo/QA organization slugs and existing active virtual key counts so operators can review the remaining state before the cutover.

## 6. Deploy with preview compose

```bash
npm run preview:up
```

`preview:up` now runs the production preflight automatically unless `TEAMOPS_SKIP_PROD_PREFLIGHT=1` is set.

## 7. Validate the live stack

```bash
npm run preview:smoke
```

Optional live gateway smoke:

```bash
PREVIEW_GATEWAY_SMOKE_BEARER_TOKEN=<new-production-key> npm run preview:smoke
```

When the optional gateway smoke token is provided, the smoke test calls the gateway and fails if the response still includes `x-teamops-demo-mode`.

## 8. Recreate the approved production routes

After the stack is live and healthy:

1. Re-enter the real provider credentials so they are encrypted with the new `ENCRYPTION_KEY_BASE64`.
2. Re-test the provider connections.
3. Re-issue only the approved production virtual keys with the smallest necessary scopes.
4. Verify one successful gateway request and one export job end to end.

Notes:
- A successful draft catalog preview proves only that the raw API key and base URL are valid at entry time.
- Saved provider catalog reload depends on the persisted encrypted credential being readable under the current runtime `ENCRYPTION_KEY_BASE64`.
