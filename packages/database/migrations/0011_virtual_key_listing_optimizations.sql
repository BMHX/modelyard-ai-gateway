create index if not exists idx_virtual_keys_workspace_id_created_at
  on virtual_keys (workspace_id, created_at desc);
