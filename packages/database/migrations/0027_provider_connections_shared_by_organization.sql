alter table if exists provider_connections
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

update provider_connections pc
set organization_id = w.organization_id
from workspaces w
where pc.workspace_id = w.id
  and pc.organization_id is null;

alter table if exists provider_connections
  alter column organization_id set not null;

create index if not exists idx_provider_connections_organization_status
  on provider_connections (organization_id, status, created_at desc);
