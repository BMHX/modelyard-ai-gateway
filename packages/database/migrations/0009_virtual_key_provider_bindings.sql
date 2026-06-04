alter table if exists virtual_keys
  add column if not exists provider_connection_id uuid references provider_connections(id) on delete set null;

with single_active_provider_per_workspace as (
  select workspace_id, min(id::text)::uuid as provider_connection_id
  from provider_connections
  where status = 'active'
  group by workspace_id
  having count(*) = 1
)
update virtual_keys as vk
set provider_connection_id = single_active_provider_per_workspace.provider_connection_id
from single_active_provider_per_workspace
where vk.workspace_id = single_active_provider_per_workspace.workspace_id
  and vk.provider_connection_id is null;

create index if not exists idx_virtual_keys_provider_connection_id on virtual_keys (provider_connection_id);
