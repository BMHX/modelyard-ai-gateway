alter table if exists saved_views
  drop constraint if exists saved_views_surface_check;

alter table if exists saved_views
  add constraint saved_views_surface_check
  check (surface in ('usage-events', 'audit-logs', 'prompt-inspections'));
