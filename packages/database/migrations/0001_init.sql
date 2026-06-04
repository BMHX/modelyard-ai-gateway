create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table if not exists provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  label text not null,
  encrypted_api_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists virtual_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  environment text not null default 'production',
  label text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists budget_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  environment text,
  monthly_usd_limit numeric(12, 2) not null,
  soft_limit_percent integer not null default 80,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  virtual_key_id uuid references virtual_keys(id) on delete set null,
  provider_connection_id uuid references provider_connections(id) on delete set null,
  request_id text,
  provider_request_id text,
  provider text not null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  cost_usd numeric(14, 6) not null default 0,
  latency_ms integer,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  actor_type text not null,
  actor_id text not null,
  action text not null,
  subject_type text not null,
  subject_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspaces_organization_id on workspaces (organization_id);
create index if not exists idx_provider_connections_workspace_id on provider_connections (workspace_id);
create index if not exists idx_virtual_keys_workspace_id on virtual_keys (workspace_id);
create index if not exists idx_budget_policies_workspace_id on budget_policies (workspace_id);
create index if not exists idx_usage_events_workspace_id_created_at on usage_events (workspace_id, created_at desc);
create index if not exists idx_audit_logs_workspace_id_created_at on audit_logs (workspace_id, created_at desc);
