create table if not exists saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  surface text not null check (surface in ('usage-events', 'audit-logs')),
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_saved_views_workspace_surface_name
  on saved_views (workspace_id, surface, name);

create index if not exists idx_saved_views_workspace_surface_created_at
  on saved_views (workspace_id, surface, created_at desc);

create table if not exists scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('usage-events', 'audit-logs')),
  format text not null check (format in ('csv', 'xlsx')),
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_scheduled_reports_workspace_name
  on scheduled_reports (workspace_id, name);

create index if not exists idx_scheduled_reports_next_run_at
  on scheduled_reports (next_run_at);

create index if not exists idx_scheduled_reports_workspace_created_at
  on scheduled_reports (workspace_id, created_at desc);
