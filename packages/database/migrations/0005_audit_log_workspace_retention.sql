alter table if exists audit_logs
  drop constraint if exists audit_logs_workspace_id_fkey;

alter table if exists audit_logs
  add constraint audit_logs_workspace_id_fkey
  foreign key (workspace_id)
  references workspaces(id)
  on delete set null;
