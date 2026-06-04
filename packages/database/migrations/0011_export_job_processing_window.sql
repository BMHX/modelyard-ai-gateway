alter table if exists export_jobs
  add column if not exists started_at timestamptz;

alter table if exists export_jobs
  add column if not exists attempt_count integer not null default 0;

create index if not exists idx_export_jobs_status_started_at
  on export_jobs (status, started_at);
