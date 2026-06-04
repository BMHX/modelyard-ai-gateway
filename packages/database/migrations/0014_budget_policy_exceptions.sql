alter table if exists budget_policies
  add column if not exists exception_status text not null default 'none';

alter table if exists budget_policies
  add column if not exists exception_reason text;

alter table if exists budget_policies
  add column if not exists exception_requested_by text;

alter table if exists budget_policies
  add column if not exists exception_requested_at timestamptz;

alter table if exists budget_policies
  add column if not exists exception_reviewed_by text;

alter table if exists budget_policies
  add column if not exists exception_reviewed_at timestamptz;

alter table if exists budget_policies
  add column if not exists exception_review_note text;

alter table if exists budget_policies
  add column if not exists exception_expires_at timestamptz;

create index if not exists idx_budget_policies_exception_status
  on budget_policies (workspace_id, exception_status, updated_at desc);
