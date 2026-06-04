alter table if exists members
  add column if not exists last_login_at timestamptz,
  add column if not exists last_active_at timestamptz;

create index if not exists idx_members_last_login_at
  on members (last_login_at desc);

create index if not exists idx_members_last_active_at
  on members (last_active_at desc);
