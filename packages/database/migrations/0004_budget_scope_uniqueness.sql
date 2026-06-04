create unique index if not exists idx_budget_policies_unique_active_scope
on budget_policies (
  workspace_id,
  coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(environment_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(environment, '')
)
where status = 'active';
