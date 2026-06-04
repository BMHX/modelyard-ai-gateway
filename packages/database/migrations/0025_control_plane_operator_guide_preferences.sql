alter table control_plane_operators
  add column if not exists guide_exited_workspace_ids jsonb not null default '[]'::jsonb;
