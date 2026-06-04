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
