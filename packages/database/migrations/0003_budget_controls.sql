alter table if exists budget_policies
  add column if not exists updated_at timestamptz not null default now();

alter table if exists alerts
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists alerts
  add column if not exists dedupe_key text;

create unique index if not exists idx_alerts_dedupe_key on alerts (dedupe_key);
create index if not exists idx_budget_policies_workspace_status on budget_policies (workspace_id, status, created_at desc);
create index if not exists idx_usage_events_project_id_created_at on usage_events (project_id, created_at desc);
