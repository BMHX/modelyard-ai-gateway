alter table if exists virtual_keys
  add column if not exists expires_at timestamptz;

create index if not exists idx_virtual_keys_expires_at on virtual_keys (expires_at);
