alter table if exists fingerprint_artifacts
  add column if not exists verification_status text not null default 'pending',
  add column if not exists verification_source text,
  add column if not exists last_verified_at timestamptz;

create index if not exists idx_fingerprint_artifacts_verification_status
  on fingerprint_artifacts (verification_status, relative_path);
