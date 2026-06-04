alter table if exists projects
  add column if not exists status text not null default 'active';

create table if not exists environments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  slug text not null,
  name text not null,
  runtime text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null,
  status text not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);

alter table if exists virtual_keys
  add column if not exists environment_id uuid references environments(id) on delete set null;

alter table if exists budget_policies
  add column if not exists environment_id uuid references environments(id) on delete set null;

alter table if exists usage_events
  add column if not exists environment_id uuid references environments(id) on delete set null;

create table if not exists export_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null,
  format text not null,
  status text not null default 'pending',
  file_name text not null,
  object_key text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  severity text not null,
  code text not null,
  title text not null,
  body text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_projects_workspace_id on projects (workspace_id);
create index if not exists idx_environments_project_id on environments (project_id);
create index if not exists idx_members_workspace_id on members (workspace_id);
create index if not exists idx_virtual_keys_environment_id on virtual_keys (environment_id);
create index if not exists idx_budget_policies_environment_id on budget_policies (environment_id);
create index if not exists idx_usage_events_environment_id_created_at on usage_events (environment_id, created_at desc);
create index if not exists idx_export_jobs_workspace_id_created_at on export_jobs (workspace_id, created_at desc);
create index if not exists idx_alerts_workspace_id_created_at on alerts (workspace_id, created_at desc);
