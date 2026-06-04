alter table if exists usage_events
  alter column workspace_id drop not null,
  alter column provider drop not null,
  alter column model drop not null;

create index if not exists idx_usage_events_project_id_created_at on usage_events (project_id, created_at desc);
create index if not exists idx_usage_events_provider_created_at on usage_events (provider, created_at desc);
create index if not exists idx_usage_events_model_created_at on usage_events (model, created_at desc);
create index if not exists idx_usage_events_status_created_at on usage_events (status, created_at desc);
