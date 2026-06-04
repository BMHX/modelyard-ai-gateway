create table if not exists member_project_assignments (
  member_id uuid not null references members(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, project_id)
);

create index if not exists idx_member_project_assignments_member_id
  on member_project_assignments (member_id, created_at desc);

create index if not exists idx_member_project_assignments_project_id
  on member_project_assignments (project_id, created_at desc);
