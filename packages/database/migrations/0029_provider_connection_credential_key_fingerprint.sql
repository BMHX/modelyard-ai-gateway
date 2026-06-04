alter table if exists provider_connections
  add column if not exists credential_key_fingerprint text;
