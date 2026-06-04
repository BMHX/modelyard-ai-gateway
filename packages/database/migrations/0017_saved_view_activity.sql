alter table saved_views
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_opened_at timestamptz;

update saved_views
set updated_at = created_at
where updated_at is null;

create index if not exists idx_saved_views_workspace_surface_last_opened_at
  on saved_views (workspace_id, surface, last_opened_at desc nulls last, updated_at desc, id desc);

create index if not exists idx_saved_views_workspace_surface_updated_at
  on saved_views (workspace_id, surface, updated_at desc, id desc);
