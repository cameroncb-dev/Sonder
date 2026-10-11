-- Explicit table privileges for the data API.
--
-- Newer hosted projects grant no SELECT/INSERT/UPDATE/DELETE on new tables to
-- anon, authenticated or service_role; older stacks (including the local CLI
-- stack) grant everything. Start from nothing everywhere so local tests match
-- hosted behaviour, then grant what each role needs. RLS still decides which
-- rows a signed-in user can touch.

revoke all on table
  public.projects, public.project_members, public.assets, public.asset_elements,
  public.connector_sessions, public.session_assets, public.checkpoints, public.checkpoint_parents,
  public.branches, public.canvas_items, public.canvas_connections, public.themes, public.theme_mappings,
  public.directions, public.direction_entries, public.proposals, public.proposal_items, public.comments,
  public.jobs, public.job_events
from anon, authenticated;

-- Backend (service role): full access; it authorizes requests itself.
grant select, insert, update, delete on table
  public.projects, public.project_members, public.assets, public.asset_elements,
  public.connector_sessions, public.session_assets, public.checkpoints, public.checkpoint_parents,
  public.branches, public.canvas_items, public.canvas_connections, public.themes, public.theme_mappings,
  public.directions, public.direction_entries, public.proposals, public.proposal_items, public.comments,
  public.jobs, public.job_events
to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Signed-in users: read what RLS lets members see …
grant select on table
  public.projects, public.project_members, public.assets, public.asset_elements, public.checkpoints,
  public.checkpoint_parents, public.branches, public.canvas_items, public.canvas_connections, public.themes,
  public.theme_mappings, public.directions, public.direction_entries, public.proposals, public.proposal_items,
  public.comments, public.jobs, public.job_events
to authenticated;

-- … and write where an RLS policy allows it. Checkpoints, jobs and sessions are
-- written only through security-definer functions or the backend.
grant update, delete on table public.projects to authenticated;
grant insert, update, delete on table
  public.project_members, public.assets, public.asset_elements, public.branches, public.canvas_items,
  public.canvas_connections, public.themes, public.theme_mappings, public.directions
to authenticated;
grant insert on table public.direction_entries, public.proposals, public.comments to authenticated;
grant delete on table public.comments to authenticated;

-- Safe connector session columns (re-stated; secrets stay hidden).
grant select (id, user_id, application, connector_version, application_version, status,
              expires_at, last_seen_at, created_at)
  on public.connector_sessions to authenticated;
