alter table if exists budget_policies
  add column if not exists exception_status text not null default 'none',
  add column if not exists exception_reason text,
  add column if not exists exception_requested_by text,
  add column if not exists exception_requested_at timestamptz,
  add column if not exists exception_reviewed_by text,
  add column if not exists exception_reviewed_at timestamptz,
  add column if not exists exception_review_note text,
  add column if not exists exception_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'budget_policies_exception_status_check'
  ) then
    alter table budget_policies
      add constraint budget_policies_exception_status_check
      check (exception_status in ('none', 'requested', 'approved', 'rejected'));
  end if;
end $$;
