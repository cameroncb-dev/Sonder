-- Connectors report whether each open linked document has unsaved or uncaptured changes, so the
-- canvas can show it before anyone captures or switches branches. Null means not yet known.

alter table public.session_assets
  add column unsaved boolean,
  add column uncaptured boolean;

-- Like report_session_assets, but takes per-document state and returns each asset's current head
-- so the connector can compare the open document with it. The text[] version stays for older
-- connectors and records unknown state.
create function public.report_session_documents(p_session_id uuid, p_documents jsonb)
returns table (asset_id uuid, project_id uuid, path text, head_checkpoint_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  s public.connector_sessions;
begin
  if jsonb_typeof(p_documents) <> 'array' then
    raise exception 'documents must be an array' using errcode = 'invalid_parameter_value';
  end if;
  s := public.require_active_session(p_session_id);
  update public.connector_sessions set last_seen_at = now() where id = s.id;
  delete from public.session_assets where session_id = s.id;
  insert into public.session_assets (session_id, asset_id, unsaved, uncaptured)
    select distinct on (a.id) s.id, a.id,
           case jsonb_typeof(d -> 'unsaved') when 'boolean' then (d ->> 'unsaved')::boolean end,
           case jsonb_typeof(d -> 'uncaptured') when 'boolean' then (d ->> 'uncaptured')::boolean end
      from jsonb_array_elements(p_documents) d
      join public.assets a on a.native_locator ->> 'path' = d ->> 'path'
     where a.application = s.application
       and public.user_can_edit(s.user_id, a.project_id);
  return query
    select a.id, a.project_id, a.native_locator ->> 'path', b.head_checkpoint_id
      from public.session_assets sa
      join public.assets a on a.id = sa.asset_id
      left join public.branches b on b.id = a.active_branch_id
     where sa.session_id = s.id;
end $$;

revoke execute on function public.report_session_documents(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.report_session_documents(uuid, jsonb) to service_role;
