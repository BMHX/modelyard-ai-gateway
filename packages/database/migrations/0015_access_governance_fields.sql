alter table if exists members
  add column if not exists temporary_access_expires_at timestamptz;

create index if not exists idx_members_temporary_access_expires_at
  on members (temporary_access_expires_at);

alter table if exists virtual_keys
  add column if not exists owner text,
  add column if not exists team text,
  add column if not exists service text;

create index if not exists idx_virtual_keys_team_service
  on virtual_keys (workspace_id, team, service);
