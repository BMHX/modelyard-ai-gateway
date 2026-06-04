create table if not exists catalog_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  model_id text not null,
  label text not null,
  protocol text not null,
  source_provider_connection_id uuid not null references provider_connections(id) on delete cascade,
  source_provider_connection_label text not null,
  source_provider text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, protocol, model_id, source_provider_connection_id)
);

create table if not exists workspace_model_assignments (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  catalog_model_id uuid not null references catalog_models(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, catalog_model_id)
);

create table if not exists provider_connection_catalog_models (
  provider_connection_id uuid not null references provider_connections(id) on delete cascade,
  catalog_model_id uuid not null references catalog_models(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider_connection_id, catalog_model_id)
);

create index if not exists idx_catalog_models_organization_protocol
  on catalog_models (organization_id, protocol, status, model_id);

create index if not exists idx_workspace_model_assignments_workspace
  on workspace_model_assignments (workspace_id, created_at desc);

create index if not exists idx_provider_connection_catalog_models_connection
  on provider_connection_catalog_models (provider_connection_id, created_at desc);

with discovered_models as (
  select distinct
    pc.organization_id,
    lower(trim(model_token)) as model_id,
    lower(trim(model_token)) as label,
    case
      when pc.provider = 'anthropic' then 'anthropic'
      else 'openai-compatible'
    end as protocol,
    pc.id as source_provider_connection_id,
    pc.label as source_provider_connection_label,
    pc.provider as source_provider
  from provider_connections pc
  cross join lateral regexp_split_to_table(
    coalesce(
      nullif(pc.metadata ->> 'models', ''),
      nullif(pc.metadata ->> 'routing.models', ''),
      nullif(pc.metadata ->> 'defaultModels', '')
    ),
    E'\\s*,\\s*'
  ) as model_token
  where pc.status = 'active'
    and trim(model_token) <> ''
)
insert into catalog_models (
  organization_id,
  model_id,
  label,
  protocol,
  source_provider_connection_id,
  source_provider_connection_label,
  source_provider,
  status
)
select
  discovered_models.organization_id,
  discovered_models.model_id,
  discovered_models.label,
  discovered_models.protocol,
  discovered_models.source_provider_connection_id,
  discovered_models.source_provider_connection_label,
  discovered_models.source_provider,
  'active'
from discovered_models
on conflict (organization_id, protocol, model_id, source_provider_connection_id) do update
set
  label = excluded.label,
  source_provider_connection_label = excluded.source_provider_connection_label,
  source_provider = excluded.source_provider,
  status = 'active',
  updated_at = now();

with provider_models as (
  select distinct
    pc.id as provider_connection_id,
    pc.organization_id,
    lower(trim(model_token)) as model_id,
    case
      when pc.provider = 'anthropic' then 'anthropic'
      else 'openai-compatible'
    end as protocol
  from provider_connections pc
  cross join lateral regexp_split_to_table(
    coalesce(
      nullif(pc.metadata ->> 'models', ''),
      nullif(pc.metadata ->> 'routing.models', ''),
      nullif(pc.metadata ->> 'defaultModels', '')
    ),
    E'\\s*,\\s*'
  ) as model_token
  where pc.status = 'active'
    and trim(model_token) <> ''
)
insert into provider_connection_catalog_models (
  provider_connection_id,
  catalog_model_id
)
select
  provider_models.provider_connection_id,
  cm.id
from provider_models
inner join catalog_models cm
  on cm.organization_id = provider_models.organization_id
 and cm.protocol = provider_models.protocol
 and cm.model_id = provider_models.model_id
 and cm.source_provider_connection_id = provider_models.provider_connection_id
on conflict do nothing;

insert into workspace_model_assignments (
  workspace_id,
  catalog_model_id
)
select
  w.id,
  cm.id
from workspaces w
inner join catalog_models cm
  on cm.organization_id = w.organization_id
where cm.status = 'active'
on conflict do nothing;
