# API Reference

## Control API

Base URL:

- local dev: `http://127.0.0.1:4001`
- docker demo: `http://127.0.0.1:4001`

Auth:

- `Authorization: Bearer <CONTROL_API_ADMIN_TOKEN>`
- or `x-member-email: member@example.com` for workspace-scoped member access

For the current seeded workspace id, project id, member emails, and virtual-key tokens, check `.demo/demo-brief.md` after `npm run demo:seed`.

### Health

```bash
curl http://127.0.0.1:4001/healthz
```

### Core resources

- `GET /v1/organizations`
- `POST /v1/organizations`
- `GET /v1/workspaces?organizationId=<org-id>`
- `POST /v1/workspaces`
- `GET /v1/projects?workspaceId=<workspace-id>`
- `POST /v1/projects`
- `GET /v1/environments?projectId=<project-id>`
- `POST /v1/environments`
- `GET /v1/members?workspaceId=<workspace-id>`
- `POST /v1/members`
- `GET /v1/member-project-assignments?workspaceId=<workspace-id>`
- `PUT /v1/members/:memberId/project-assignments`
- `GET /v1/provider-connections?workspaceId=<workspace-id>`
- `POST /v1/provider-connections`
- `GET /v1/virtual-keys?workspaceId=<workspace-id>`
- `POST /v1/virtual-keys`

### Budgets

- `GET /v1/budgets?workspaceId=<workspace-id>`
- `POST /v1/budgets`
- `PATCH /v1/budgets/:budgetPolicyId`
- `DELETE /v1/budgets/:budgetPolicyId`

Create a workspace-wide budget:

```bash
curl -X POST http://127.0.0.1:4001/v1/budgets \
  -H "Authorization: Bearer demo-admin-token" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "WORKSPACE_ID",
    "projectId": null,
    "environmentId": null,
    "environment": null,
    "monthlyUsdLimit": 150,
    "softLimitPercent": 80
  }'
```

### Operations

- `GET /v1/usage-events?workspaceId=<workspace-id>&projectId=<project-id>&environmentId=<environment-id>&provider=<provider>&model=<model>&requestId=<gateway-request-id>&providerRequestId=<provider-request-id>&status=<status>&from=<iso8601>&to=<iso8601>&limit=25&offset=0`
- `GET /v1/usage-events/summary?workspaceId=<workspace-id>&projectId=<project-id>&environmentId=<environment-id>&provider=<provider>&model=<model>&requestId=<gateway-request-id>&providerRequestId=<provider-request-id>&status=<status>&from=<iso8601>&to=<iso8601>`
- `GET /v1/usage-events/<usage-event-id>`
- `GET /v1/audit-logs?workspaceId=<workspace-id>&limit=25&offset=0`
- `GET /v1/alerts?workspaceId=<workspace-id>`
- `GET /v1/export-jobs?workspaceId=<workspace-id>`
- `POST /v1/export-jobs`

Create an export job:

```bash
curl -X POST http://127.0.0.1:4001/v1/export-jobs \
  -H "Authorization: Bearer demo-admin-token" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "WORKSPACE_ID",
    "kind": "usage-events",
    "format": "csv",
    "fileName": "usage-export.csv"
  }'
```

## Gateway

Base URL:

- local dev: `http://127.0.0.1:4002`
- docker demo: `http://127.0.0.1:4002`

Auth:

- `Authorization: Bearer teamops_vk_...`

Supported request paths:

- `POST /v1/messages`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `GET /v1/models`
- `GET /v1/models/:modelId`

Gateway routing notes:

- `POST /v1/messages` is treated as Anthropic protocol and requires an Anthropic provider connection.
- `POST /v1/chat/completions`, `POST /v1/responses`, `GET /v1/models`, and `GET /v1/models/:modelId` are treated as OpenAI-compatible protocol and require an `openai` or `openai-compatible` provider connection.
- If a virtual key is explicitly bound to a provider connection, the gateway will use that connection and reject protocol mismatches with `409`.
- If a workspace has multiple matching provider connections, you can disambiguate with request headers:
  - `x-provider-connection-id: <provider-connection-id>`
  - `x-provider-kind: anthropic | openai | openai-compatible`
- Provider connection metadata can further steer routing:
  - `defaultForProtocol=anthropic|openai-compatible`
  - `models=<comma-separated exact model ids>`
  - `modelPrefixes=<comma-separated prefixes>`

Provider connection metadata supported by the gateway:

- `baseUrl` or `apiBase`: override the upstream base URL
- `anthropicVersion`: default `anthropic-version` header for Anthropic requests
- `header.<Header-Name>` or `headers.<Header-Name>`: inject extra upstream request headers
- `defaultForProtocol`, `models`, `modelPrefixes`: gateway-side provider routing hints

Gateway response headers:

- `x-teamops-request-id`: gateway request id
- `x-teamops-gateway-protocol`: `anthropic` or `openai-compatible`
- `x-teamops-provider`: selected provider kind when known
- `x-teamops-provider-connection-id`: selected provider connection id when known
- `x-teamops-upstream-status`: upstream HTTP status when a provider request ran
- `x-teamops-upstream-request-id`: upstream request id when available
- `x-teamops-provider-request-id`: provider object/request id when available
- `x-teamops-upstream-content-type`: upstream response content type when available
- `x-teamops-demo-mode: 1`: synthetic/demo response path

Gateway default cache and safety headers:

- `Cache-Control: no-store`
- `Vary: authorization, accept, x-provider-connection-id, x-provider-kind, x-teamops-provider`
- `X-Content-Type-Options: nosniff`

Gateway-generated error shape:

- Anthropic routes return:

```json
{
  "type": "error",
  "error": {
    "type": "authentication_error",
    "message": "Invalid virtual key"
  },
  "request_id": "req_..."
}
```

- OpenAI-compatible routes return:

```json
{
  "error": {
    "message": "Invalid virtual key",
    "type": "authentication_error",
    "param": null,
    "code": "teamops_invalid_virtual_key"
  }
}
```

### Demo mode

When `DEMO_MODE=1`, the gateway returns synthetic responses and still writes:

- usage events
- budget threshold alerts
- blocked/error events where applicable

This lets us demo the platform end-to-end without live provider credentials.

### Anthropic-style example

Use one of the seeded virtual-key tokens printed by `npm run demo:seed`:

```bash
curl -X POST http://127.0.0.1:4002/v1/messages \
  -H "Authorization: Bearer SEEDED_VIRTUAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {
        "role": "user",
        "content": "Summarize the current pilot status."
      }
    ]
  }'
```

### OpenAI-compatible example

```bash
curl -X POST http://127.0.0.1:4002/v1/chat/completions \
  -H "Authorization: Bearer SEEDED_VIRTUAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [
      {
        "role": "user",
        "content": "Explain the budget posture for this workspace."
      }
    ]
  }'
```

### OpenAI Responses example

```bash
curl -X POST http://127.0.0.1:4002/v1/responses \
  -H "Authorization: Bearer SEEDED_OPENAI_VIRTUAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "input": "Summarize the pilot workspace status."
  }'
```

### OpenAI Models example

```bash
curl http://127.0.0.1:4002/v1/models \
  -H "Authorization: Bearer SEEDED_OPENAI_VIRTUAL_KEY"
```

### OpenAI Model Detail example

```bash
curl http://127.0.0.1:4002/v1/models/gpt-4.1-mini \
  -H "Authorization: Bearer SEEDED_OPENAI_VIRTUAL_KEY"
```
