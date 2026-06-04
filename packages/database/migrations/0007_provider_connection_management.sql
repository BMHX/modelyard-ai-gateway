alter table if exists provider_connections
  add column if not exists revoked_at timestamptz,
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_test_status text,
  add column if not exists last_test_error text,
  add column if not exists last_test_status_code integer,
  add column if not exists last_test_latency_ms integer;

update provider_connections
set revoked_at = coalesce(revoked_at, updated_at, created_at)
where status = 'revoked'
  and revoked_at is null;

create index if not exists idx_provider_connections_workspace_status
  on provider_connections (workspace_id, status, created_at desc);
