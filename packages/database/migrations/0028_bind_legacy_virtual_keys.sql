with visible_active_candidates as (
  select
    vk.id as virtual_key_id,
    array_agg(pc.id order by pc.created_at desc) as provider_connection_ids
  from virtual_keys vk
  inner join workspaces w on w.id = vk.workspace_id
  inner join provider_connections pc on pc.status = 'active'
  left join workspaces provider_workspace on provider_workspace.id = pc.workspace_id
  where vk.provider_connection_id is null
    and (
      pc.organization_id = w.organization_id
      or (
        pc.organization_id is null
        and provider_workspace.organization_id = w.organization_id
      )
    )
  group by vk.id
),
uniquely_resolved as (
  select
    virtual_key_id,
    provider_connection_ids[1] as provider_connection_id
  from visible_active_candidates
  where coalesce(array_length(provider_connection_ids, 1), 0) = 1
)
update virtual_keys vk
set provider_connection_id = uniquely_resolved.provider_connection_id
from uniquely_resolved
where vk.id = uniquely_resolved.virtual_key_id
  and vk.provider_connection_id is null;
