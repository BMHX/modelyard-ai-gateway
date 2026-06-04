alter table if exists audit_logs
  add column if not exists project_id uuid references projects(id) on delete set null;

alter table if exists audit_logs
  add column if not exists environment_id uuid references environments(id) on delete set null;

create index if not exists idx_audit_logs_workspace_project_created_at
  on audit_logs (workspace_id, project_id, created_at desc);

create index if not exists idx_audit_logs_workspace_environment_created_at
  on audit_logs (workspace_id, environment_id, created_at desc);
