alter table virtual_keys
  add column if not exists issuance_mode text not null default 'admin',
  add column if not exists issued_by_member_id uuid references members(id) on delete set null;

create index if not exists idx_virtual_keys_self_serve_member_project
  on virtual_keys (workspace_id, issued_by_member_id, project_id, status, issuance_mode);
