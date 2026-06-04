-- Migration: 0026_multi_role_and_active_identity.sql

-- 1. Update members table to support multiple roles
alter table members add column roles text[] not null default '{}';

-- Migrate existing 'role' to the new 'roles' array
update members set roles = array[role] where roles = '{}';

-- 2. Update control_plane_sessions table to track active identity
alter table control_plane_sessions add column active_membership_id uuid references members(id) on delete set null;
alter table control_plane_sessions add column active_role text;

-- Add index for performance on session lookup by active identity
create index if not exists idx_control_plane_sessions_active_membership_id on control_plane_sessions (active_membership_id);
