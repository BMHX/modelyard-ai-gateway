alter table if exists organizations
  add column if not exists customer_id text;

update organizations
set customer_id = concat('cus_', replace(gen_random_uuid()::text, '-', ''))
where customer_id is null;

create unique index if not exists idx_organizations_customer_id
  on organizations (customer_id);

alter table if exists usage_events
  add column if not exists customer_id text,
  add column if not exists deployment_id text,
  add column if not exists release_id text,
  add column if not exists fingerprint_id text,
  add column if not exists manifest_hash text;

create index if not exists idx_usage_events_fingerprint_created_at
  on usage_events (fingerprint_id, created_at desc);

create index if not exists idx_usage_events_deployment_created_at
  on usage_events (deployment_id, created_at desc);

alter table if exists audit_logs
  add column if not exists customer_id text,
  add column if not exists deployment_id text,
  add column if not exists release_id text,
  add column if not exists fingerprint_id text;

create index if not exists idx_audit_logs_fingerprint_created_at
  on audit_logs (fingerprint_id, created_at desc);

create index if not exists idx_audit_logs_deployment_created_at
  on audit_logs (deployment_id, created_at desc);

alter table if exists export_jobs
  add column if not exists evidence_bundle_id text,
  add column if not exists evidence_bundle_object_key text,
  add column if not exists evidence_bundle_hash text,
  add column if not exists fingerprint_id text,
  add column if not exists deployment_id text,
  add column if not exists release_id text;

create table if not exists customer_deployments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  customer_id text not null,
  deployment_id text not null unique,
  deployment_name text not null,
  deployment_mode text not null,
  region text,
  install_channel text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_customer_deployments_customer_id
  on customer_deployments (customer_id, created_at desc);

create table if not exists release_catalog (
  id uuid primary key default gen_random_uuid(),
  release_id text not null unique,
  channel text not null,
  version text not null,
  git_commit_sha text,
  build_system text,
  manifest_hash text not null unique,
  artifact_manifest jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  superseded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_release_catalog_version_published_at
  on release_catalog (version, published_at desc);

create table if not exists fingerprint_key_versions (
  id uuid primary key default gen_random_uuid(),
  key_id text not null unique,
  purpose text not null,
  algorithm text not null,
  status text not null default 'active',
  wrapping_key_ref text not null,
  wrapped_key_material text not null,
  public_key_material text,
  created_by_type text not null,
  created_by_id text not null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  destroy_after timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_fingerprint_key_versions_purpose_status
  on fingerprint_key_versions (purpose, status, created_at desc);

create table if not exists fingerprint_issuances (
  id uuid primary key default gen_random_uuid(),
  fingerprint_id text not null unique,
  fingerprint_token text not null unique,
  organization_id uuid references organizations(id) on delete set null,
  customer_id text not null,
  deployment_row_id uuid references customer_deployments(id) on delete set null,
  deployment_id text not null,
  release_row_id uuid references release_catalog(id) on delete set null,
  release_id text not null,
  manifest_hash text not null,
  status text not null default 'issued',
  issued_by_type text not null,
  issued_by_id text not null,
  issued_at timestamptz not null default now(),
  hmac_key_id text not null,
  signing_key_id text not null,
  evidence_bundle_id text not null,
  evidence_root_hash text not null,
  revoked_at timestamptz,
  revoked_by_type text,
  revoked_by_id text,
  revoke_reason text,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists idx_fingerprint_issuances_deployment_release_manifest
  on fingerprint_issuances (deployment_id, release_id, manifest_hash)
  where status in ('issued', 'active');

create index if not exists idx_fingerprint_issuances_customer_issued_at
  on fingerprint_issuances (customer_id, issued_at desc);

create table if not exists fingerprint_artifacts (
  id uuid primary key default gen_random_uuid(),
  fingerprint_id text not null references fingerprint_issuances(fingerprint_id) on delete cascade,
  artifact_role text not null,
  relative_path text not null,
  object_key text,
  sha256 text not null,
  size_bytes bigint,
  embed_locator jsonb not null default '{}'::jsonb,
  verification_status text not null default 'pending',
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (fingerprint_id, relative_path)
);

create index if not exists idx_fingerprint_artifacts_sha256
  on fingerprint_artifacts (sha256);

create table if not exists evidence_bundles (
  id uuid primary key default gen_random_uuid(),
  evidence_bundle_id text not null unique,
  fingerprint_id text references fingerprint_issuances(fingerprint_id) on delete set null,
  export_job_id uuid references export_jobs(id) on delete set null,
  bundle_kind text not null,
  object_key text,
  content_sha256 text not null,
  content_size_bytes bigint,
  generated_at timestamptz not null default now(),
  retained_until timestamptz,
  legal_hold boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_evidence_bundles_fingerprint_generated_at
  on evidence_bundles (fingerprint_id, generated_at desc);

create index if not exists idx_evidence_bundles_export_job_generated_at
  on evidence_bundles (export_job_id, generated_at desc);

create table if not exists evidence_chain_records (
  id uuid primary key default gen_random_uuid(),
  evidence_record_id text not null unique,
  chain_scope text not null,
  fingerprint_id text references fingerprint_issuances(fingerprint_id) on delete set null,
  audit_log_id uuid references audit_logs(id) on delete set null,
  usage_event_id uuid references usage_events(id) on delete set null,
  export_job_id uuid references export_jobs(id) on delete set null,
  event_type text not null,
  actor_type text not null,
  actor_id text not null,
  occurred_at timestamptz not null,
  previous_record_hash text,
  payload jsonb not null default '{}'::jsonb,
  canonical_payload_hash text not null,
  record_hash text not null unique,
  signing_key_id text not null,
  signature text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_evidence_chain_records_chain_scope_occurred_at
  on evidence_chain_records (chain_scope, occurred_at asc);

create index if not exists idx_evidence_chain_records_fingerprint_occurred_at
  on evidence_chain_records (fingerprint_id, occurred_at asc);
