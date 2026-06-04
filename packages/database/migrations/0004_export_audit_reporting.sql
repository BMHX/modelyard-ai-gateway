alter table if exists export_jobs
  add column if not exists filters jsonb not null default '{}'::jsonb;

alter table if exists export_jobs
  add column if not exists row_count integer;

alter table if exists export_jobs
  add column if not exists error_message text;

create index if not exists idx_export_jobs_workspace_status_created_at
  on export_jobs (workspace_id, status, created_at desc);

create index if not exists idx_audit_logs_action_created_at
  on audit_logs (action, created_at desc);

create index if not exists idx_audit_logs_actor_id_created_at
  on audit_logs (actor_id, created_at desc);

create index if not exists idx_audit_logs_subject_type_created_at
  on audit_logs (subject_type, created_at desc);
