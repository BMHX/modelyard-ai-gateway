alter table if exists catalog_models
  add column if not exists source_provider_connection_id uuid references provider_connections(id) on delete cascade;

alter table if exists catalog_models
  add column if not exists source_provider_connection_label text;

alter table if exists catalog_models
  add column if not exists source_provider text;
