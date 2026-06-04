create table if not exists model_mappings (
  id uuid primary key default gen_random_uuid(),
  mapping_key text not null unique,
  provider text not null,
  provider_model text not null,
  canonical_model text not null,
  model_family text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists price_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique,
  provider text not null,
  provider_connection_id uuid references provider_connections(id) on delete set null,
  provider_model text not null,
  canonical_model text not null,
  input_usd_per_million numeric(14, 6) not null,
  output_usd_per_million numeric(14, 6) not null,
  pricing_source text not null,
  metadata jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create table if not exists usage_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  usage_event_id uuid not null unique references usage_events(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  workspace_id uuid references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  environment_id uuid references environments(id) on delete set null,
  provider_connection_id uuid references provider_connections(id) on delete set null,
  virtual_key_id uuid references virtual_keys(id) on delete set null,
  owner text,
  provider text,
  provider_model text,
  canonical_model text,
  model_family text,
  price_snapshot_id uuid references price_snapshots(id) on delete set null,
  pricing_source text not null default 'unknown',
  input_usd_per_million numeric(14, 6),
  output_usd_per_million numeric(14, 6),
  status text not null,
  request_id text,
  provider_request_id text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_usd numeric(14, 6) not null default 0,
  event_date date not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists usage_forecast_daily (
  id uuid primary key default gen_random_uuid(),
  dimension_key text not null unique,
  bucket_date date not null,
  organization_id uuid references organizations(id) on delete set null,
  workspace_id uuid references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  environment_id uuid references environments(id) on delete set null,
  provider text,
  owner text,
  canonical_model text,
  request_count integer not null default 0,
  total_prompt_tokens integer not null default 0,
  total_completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  total_cost_usd numeric(14, 6) not null default 0,
  first_event_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_model_mappings_provider_canonical on model_mappings (provider, canonical_model);
create index if not exists idx_price_snapshots_provider_captured_at on price_snapshots (provider, captured_at desc);
create index if not exists idx_usage_ledger_entries_workspace_event_date on usage_ledger_entries (workspace_id, event_date desc);
create index if not exists idx_usage_ledger_entries_org_event_date on usage_ledger_entries (organization_id, event_date desc);
create index if not exists idx_usage_ledger_entries_project_event_date on usage_ledger_entries (project_id, event_date desc);
create index if not exists idx_usage_ledger_entries_environment_event_date on usage_ledger_entries (environment_id, event_date desc);
create index if not exists idx_usage_ledger_entries_owner_event_date on usage_ledger_entries (owner, event_date desc);
create index if not exists idx_usage_ledger_entries_provider_model on usage_ledger_entries (provider, canonical_model, event_date desc);
create index if not exists idx_usage_forecast_daily_workspace_bucket_date on usage_forecast_daily (workspace_id, bucket_date desc);
create index if not exists idx_usage_forecast_daily_org_bucket_date on usage_forecast_daily (organization_id, bucket_date desc);
