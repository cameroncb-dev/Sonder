-- Phase 3: core data model.
--
-- Shared tables are application-agnostic: an asset records its application,
-- and connector-specific data lives in jsonb (native_locator, native_ref,
-- manifest). Nothing here assumes Photoshop layers.

create type public.project_role as enum ('owner', 'editor', 'reviewer');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.project_role not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  application text not null check (application ~ '^[a-z][a-z0-9_-]{0,63}$'),
  name text not null check (char_length(name) between 1 and 300),
  -- How a connector finds the native document, e.g. {"path": "/…/poster.psd"}.
  native_locator jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (project_id, id)
);
create index assets_project_idx on public.assets (project_id);

-- Role-to-native-object mappings (validated by the connector before every operation).
create table public.asset_elements (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  role text not null check (role ~ '^[a-z][a-z0-9_]{0,63}$'),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  native_ref jsonb not null,
  created_at timestamptz not null default now(),
  unique (asset_id, role)
);

create table public.connector_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Null until a signed-in user approves the pairing code.
  user_id uuid references auth.users (id) on delete cascade,
  application text not null check (application ~ '^[a-z][a-z0-9_-]{0,63}$'),
  connector_version text not null,
  application_version text,
  -- The connector's capability manifest; job routing reads `operations` from it.
  capabilities jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'active', 'revoked')),
  pairing_code text unique,
  pairing_secret_hash text,
  pairing_expires_at timestamptz,
  token_hash text unique,
  expires_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  check (status = 'pending' or user_id is not null)
);

-- Assets whose native documents a session currently has open (reported by heartbeat).
create table public.session_assets (
  session_id uuid not null references public.connector_sessions (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  reported_at timestamptz not null default now(),
  primary key (session_id, asset_id)
);

create table public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  asset_id uuid not null,
  -- 'pending' checkpoints are incomplete uploads and are never recoverable.
  status text not null default 'pending' check (status in ('pending', 'finalized')),
  -- Idempotency key: repeated delivery of one operation cannot create a second checkpoint.
  operation_id text not null unique check (char_length(operation_id) between 8 and 200),
  manifest jsonb not null,
  message text,
  native_path text,
  native_bytes bigint,
  native_digest text,
  preview_path text,
  preview_bytes bigint,
  preview_digest text,
  created_by uuid references auth.users (id),
  session_id uuid references public.connector_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (asset_id, id),
  foreign key (project_id, asset_id) references public.assets (project_id, id) on delete cascade,
  check (
    status = 'pending'
    or (native_path is not null and preview_path is not null and native_digest is not null
        and preview_digest is not null and finalized_at is not null)
  )
);
create index checkpoints_asset_idx on public.checkpoints (asset_id, created_at);

-- Parent links. Composite keys force parents to belong to the same asset;
-- combined checkpoints have several parents.
create table public.checkpoint_parents (
  asset_id uuid not null,
  checkpoint_id uuid not null,
  parent_id uuid not null,
  primary key (checkpoint_id, parent_id),
  foreign key (asset_id, checkpoint_id) references public.checkpoints (asset_id, id) on delete cascade,
  foreign key (asset_id, parent_id) references public.checkpoints (asset_id, id) on delete cascade,
  check (checkpoint_id <> parent_id)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  head_checkpoint_id uuid not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id, name),
  -- A branch can only point at a checkpoint of its own asset.
  foreign key (asset_id, head_checkpoint_id) references public.checkpoints (asset_id, id)
);

create table public.canvas_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  item_type text not null check (item_type in ('asset', 'reference', 'note', 'direction', 'theme')),
  ref_id uuid,
  x double precision not null default 0,
  y double precision not null default 0,
  width double precision,
  height double precision,
  content jsonb not null default '{}'::jsonb,
  -- Optimistic concurrency for canvas saves (Phase 4).
  version integer not null default 1,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
create index canvas_items_project_idx on public.canvas_items (project_id);

-- Visual connections only. They never affect checkpoint ancestry.
create table public.canvas_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  from_item_id uuid not null references public.canvas_items (id) on delete cascade,
  to_item_id uuid not null references public.canvas_items (id) on delete cascade,
  label text,
  created_at timestamptz not null default now()
);

create table public.themes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  -- {"primary": "#RRGGBB", "background": …, "text": …, "accent": …}
  colors jsonb not null default '{}'::jsonb,
  reference_path text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create table public.theme_mappings (
  id uuid primary key default gen_random_uuid(),
  theme_id uuid not null references public.themes (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  color_role text not null check (color_role in ('primary', 'background', 'text', 'accent')),
  element_role text not null check (element_role ~ '^[a-z][a-z0-9_]{0,63}$'),
  property text not null check (property in ('text.color', 'fill.color')),
  unique (theme_id, asset_id, element_role, property)
);

create table public.directions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

-- Exact checkpoints, so a direction is stable when branches advance.
create table public.direction_entries (
  direction_id uuid not null references public.directions (id) on delete cascade,
  asset_id uuid not null,
  checkpoint_id uuid not null,
  primary key (direction_id, asset_id),
  foreign key (asset_id, checkpoint_id) references public.checkpoints (asset_id, id)
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('branch_combination', 'coordinated_update')),
  status text not null default 'draft' check (
    status in ('draft', 'preparing', 'ready', 'approved', 'rejected', 'finalized', 'partially_failed', 'failed')
  ),
  request jsonb not null,
  created_by uuid references auth.users (id),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  source_checkpoint_ids uuid[] not null default '{}',
  candidate_checkpoint_id uuid references public.checkpoints (id),
  status text not null default 'pending' check (
    status in ('pending', 'running', 'ready', 'approved', 'finalized', 'failed', 'excluded')
  ),
  outcome jsonb,
  unique (proposal_id, asset_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  target_type text not null check (
    target_type in ('project', 'asset', 'checkpoint', 'proposal', 'canvas_item', 'direction')
  ),
  target_id uuid,
  body text not null check (char_length(body) between 1 and 10000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- Finalized checkpoint contents are immutable; pending ones may only be finalized.
create function public.guard_checkpoint_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'finalized' then
    raise exception 'checkpoint % is finalized and immutable', old.id using errcode = 'check_violation';
  end if;
  if new.id <> old.id or new.asset_id <> old.asset_id or new.project_id <> old.project_id
     or new.operation_id <> old.operation_id then
    raise exception 'checkpoint identity cannot change' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger checkpoints_guard_update before update on public.checkpoints
  for each row execute function public.guard_checkpoint_update();

-- Branches, parents and directions may only reference finalized checkpoints.
create function public.require_finalized_checkpoint() returns trigger
language plpgsql set search_path = '' as $$
declare
  target uuid;
begin
  -- Separate branches: PL/pgSQL resolves every field in a CASE expression.
  if tg_table_name = 'branches' then
    target := new.head_checkpoint_id;
  elsif tg_table_name = 'checkpoint_parents' then
    target := new.parent_id;
  else
    target := new.checkpoint_id;
  end if;
  if not exists (select 1 from public.checkpoints where id = target and status = 'finalized') then
    raise exception 'checkpoint % is not finalized', target using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger branches_finalized before insert or update of head_checkpoint_id on public.branches
  for each row execute function public.require_finalized_checkpoint();
create trigger checkpoint_parents_finalized before insert on public.checkpoint_parents
  for each row execute function public.require_finalized_checkpoint();
create trigger direction_entries_finalized before insert or update on public.direction_entries
  for each row execute function public.require_finalized_checkpoint();

-- Direction entries are pinned; changing which checkpoint an entry names is not allowed.
create function public.guard_direction_entry_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'direction entries are immutable; create a new direction' using errcode = 'check_violation';
end $$;
create trigger direction_entries_immutable before update on public.direction_entries
  for each row execute function public.guard_direction_entry_update();

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer avoids RLS recursion on project_members)
-- ---------------------------------------------------------------------------

create function public.has_project_role(p_project_id uuid, p_roles public.project_role[])
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = (select auth.uid()) and role = any (p_roles)
  );
$$;

create function public.is_project_member(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_project_role(p_project_id, array['owner', 'editor', 'reviewer']::public.project_role[]);
$$;

create function public.can_edit_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_project_role(p_project_id, array['owner', 'editor']::public.project_role[]);
$$;

create function public.asset_project(p_asset_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select project_id from public.assets where id = p_asset_id;
$$;

-- Creates a project and its owner membership atomically for the calling user.
create function public.create_project(p_name text) returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  result public.projects;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  insert into public.projects (name, created_by) values (p_name, auth.uid()) returning * into result;
  insert into public.project_members (project_id, user_id, role) values (result.id, auth.uid(), 'owner');
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.assets enable row level security;
alter table public.asset_elements enable row level security;
alter table public.connector_sessions enable row level security;
alter table public.session_assets enable row level security;
alter table public.checkpoints enable row level security;
alter table public.checkpoint_parents enable row level security;
alter table public.branches enable row level security;
alter table public.canvas_items enable row level security;
alter table public.canvas_connections enable row level security;
alter table public.themes enable row level security;
alter table public.theme_mappings enable row level security;
alter table public.directions enable row level security;
alter table public.direction_entries enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_items enable row level security;
alter table public.comments enable row level security;

-- Projects and membership
create policy "members read projects" on public.projects for select to authenticated
  using (public.is_project_member(id));
create policy "owners rename projects" on public.projects for update to authenticated
  using (public.has_project_role(id, array['owner']::public.project_role[]));
create policy "owners delete projects" on public.projects for delete to authenticated
  using (public.has_project_role(id, array['owner']::public.project_role[]));

create policy "members read membership" on public.project_members for select to authenticated
  using (public.is_project_member(project_id));
create policy "owners manage membership" on public.project_members for all to authenticated
  using (public.has_project_role(project_id, array['owner']::public.project_role[]))
  with check (public.has_project_role(project_id, array['owner']::public.project_role[]));

-- Generic member-read / editor-write tables keyed by project_id
create policy "members read assets" on public.assets for select to authenticated
  using (public.is_project_member(project_id));
create policy "editors write assets" on public.assets for all to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

create policy "members read elements" on public.asset_elements for select to authenticated
  using (public.is_project_member(public.asset_project(asset_id)));
create policy "editors write elements" on public.asset_elements for all to authenticated
  using (public.can_edit_project(public.asset_project(asset_id)))
  with check (public.can_edit_project(public.asset_project(asset_id)));

-- Only finalized checkpoints are visible; writes go through the backend.
create policy "members read finalized checkpoints" on public.checkpoints for select to authenticated
  using (status = 'finalized' and public.is_project_member(project_id));

create policy "members read ancestry" on public.checkpoint_parents for select to authenticated
  using (public.is_project_member(public.asset_project(asset_id)));

create policy "members read branches" on public.branches for select to authenticated
  using (public.is_project_member(public.asset_project(asset_id)));
create policy "editors write branches" on public.branches for all to authenticated
  using (public.can_edit_project(public.asset_project(asset_id)))
  with check (public.can_edit_project(public.asset_project(asset_id)));

create policy "members read canvas" on public.canvas_items for select to authenticated
  using (public.is_project_member(project_id));
create policy "editors write canvas" on public.canvas_items for all to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

create policy "members read connections" on public.canvas_connections for select to authenticated
  using (public.is_project_member(project_id));
create policy "editors write connections" on public.canvas_connections for all to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

create policy "members read themes" on public.themes for select to authenticated
  using (public.is_project_member(project_id));
create policy "editors write themes" on public.themes for all to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

create policy "members read theme mappings" on public.theme_mappings for select to authenticated
  using (public.is_project_member(public.asset_project(asset_id)));
create policy "editors write theme mappings" on public.theme_mappings for all to authenticated
  using (public.can_edit_project(public.asset_project(asset_id)))
  with check (public.can_edit_project(public.asset_project(asset_id)));

create policy "members read directions" on public.directions for select to authenticated
  using (public.is_project_member(project_id));
create policy "editors write directions" on public.directions for all to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

create policy "members read direction entries" on public.direction_entries for select to authenticated
  using (public.is_project_member(public.asset_project(asset_id)));
create policy "editors add direction entries" on public.direction_entries for insert to authenticated
  with check (public.can_edit_project(public.asset_project(asset_id)));

-- Proposals: editors create; approval is recorded by the backend (Phase 5).
create policy "members read proposals" on public.proposals for select to authenticated
  using (public.is_project_member(project_id));
create policy "editors create proposals" on public.proposals for insert to authenticated
  with check (public.can_edit_project(project_id) and created_by = (select auth.uid()));

create policy "members read proposal items" on public.proposal_items for select to authenticated
  using (public.is_project_member(public.asset_project(asset_id)));

-- Comments: any member, including reviewers, can comment; authors delete their own.
create policy "members read comments" on public.comments for select to authenticated
  using (public.is_project_member(project_id));
create policy "members comment" on public.comments for insert to authenticated
  with check (public.is_project_member(project_id) and created_by = (select auth.uid()));
create policy "authors delete comments" on public.comments for delete to authenticated
  using (created_by = (select auth.uid()));

-- Sessions: users may see their own sessions; pairing and tokens are backend-only.
create policy "users read own sessions" on public.connector_sessions for select to authenticated
  using (user_id = (select auth.uid()));
-- session_assets: no client access (backend only).

-- Column-level protection: secrets never leave the database through the API.
-- (A column revoke is ineffective while a table-wide grant exists, so re-grant safe columns.)
revoke all on public.connector_sessions from anon, authenticated;
grant select (id, user_id, application, connector_version, application_version, status,
              expires_at, last_seen_at, created_at)
  on public.connector_sessions to authenticated;
revoke all on public.session_assets from anon, authenticated;
