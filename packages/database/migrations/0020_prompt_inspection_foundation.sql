create table if not exists prompt_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  enabled boolean not null default false,
  enforcement_mode text not null default 'graded',
  evidence_mode text not null default 'redacted_snippet',
  review_threshold integer not null default 60,
  block_threshold integer not null default 100,
  allowed_external_domains text[] not null default array[]::text[],
  allowed_keyword_overrides text[] not null default array[]::text[],
  disabled_rule_ids text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists prompt_inspections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  environment_id uuid references environments(id) on delete set null,
  virtual_key_id uuid references virtual_keys(id) on delete set null,
  provider_connection_id uuid references provider_connections(id) on delete set null,
  request_id text not null,
  usage_event_id uuid references usage_events(id) on delete set null,
  provider text,
  model text,
  verdict text not null,
  score integer not null default 0,
  top_activity_label text not null default 'unknown',
  risk_categories text[] not null default array[]::text[],
  hit_rule_ids text[] not null default array[]::text[],
  redacted_evidence text[] not null default array[]::text[],
  simhash text,
  truncated boolean not null default false,
  context_counts jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending',
  reviewed_by text,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_prompt_policies_workspace_id
  on prompt_policies (workspace_id);

create index if not exists idx_prompt_inspections_workspace_created_at
  on prompt_inspections (workspace_id, created_at desc);

create index if not exists idx_prompt_inspections_request_id
  on prompt_inspections (request_id);

create index if not exists idx_prompt_inspections_usage_event_id
  on prompt_inspections (usage_event_id);

create index if not exists idx_prompt_inspections_virtual_key_created_at
  on prompt_inspections (virtual_key_id, created_at desc);

create index if not exists idx_prompt_inspections_verdict_created_at
  on prompt_inspections (verdict, created_at desc);

create index if not exists idx_prompt_inspections_review_status_created_at
  on prompt_inspections (review_status, created_at desc);
