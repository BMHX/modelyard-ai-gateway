create table if not exists control_plane_operators (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  name text not null,
  status text not null default 'active',
  provisioning_source text not null default 'oidc',
  last_login_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table if not exists identity_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider_type text not null,
  issuer text not null,
  authorization_endpoint text not null,
  token_endpoint text not null,
  userinfo_endpoint text,
  jwks_uri text not null,
  client_id text not null,
  encrypted_client_secret text,
  scopes jsonb not null default '["openid","email","profile"]'::jsonb,
  domain_hint text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

create table if not exists external_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  identity_provider_id uuid not null references identity_providers(id) on delete cascade,
  operator_id uuid not null references control_plane_operators(id) on delete cascade,
  issuer text not null,
  subject text not null,
  email text,
  email_verified boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_provider_id, subject)
);

create table if not exists control_plane_sessions (
  id uuid primary key default gen_random_uuid(),
  session_handle_hash text not null unique,
  organization_id uuid not null references organizations(id) on delete cascade,
  operator_id uuid not null references control_plane_operators(id) on delete cascade,
  identity_provider_id uuid not null references identity_providers(id) on delete cascade,
  external_identity_id uuid not null references external_identities(id) on delete cascade,
  email text not null,
  amr jsonb not null default '[]'::jsonb,
  issued_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  revoked_at timestamptz,
  ip_address text,
  user_agent text,
  impersonated_by_operator_id uuid references control_plane_operators(id) on delete set null
);

create table if not exists session_revocations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references control_plane_sessions(id) on delete cascade,
  reason text not null,
  revoked_at timestamptz not null default now(),
  actor_type text not null,
  actor_id text not null
);

create index if not exists idx_control_plane_operators_organization_id
  on control_plane_operators (organization_id, created_at desc);

create index if not exists idx_control_plane_operators_email
  on control_plane_operators (email);

create index if not exists idx_identity_providers_status
  on identity_providers (status, updated_at desc);

create index if not exists idx_external_identities_operator_id
  on external_identities (operator_id, updated_at desc);

create index if not exists idx_control_plane_sessions_operator_id
  on control_plane_sessions (operator_id, issued_at desc);

create index if not exists idx_control_plane_sessions_expires_at
  on control_plane_sessions (expires_at, idle_expires_at);

create index if not exists idx_session_revocations_session_id
  on session_revocations (session_id, revoked_at desc);
