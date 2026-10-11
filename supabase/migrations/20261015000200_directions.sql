-- Phase 6: directions. A direction pins exact checkpoints of several assets; its entries are
-- immutable (existing trigger). When a document is deleted with its history, its entries go
-- with it rather than blocking the deletion; the direction keeps its other documents.
alter table public.direction_entries drop constraint direction_entries_asset_id_checkpoint_id_fkey;
alter table public.direction_entries
  add constraint direction_entries_asset_id_checkpoint_id_fkey
  foreign key (asset_id, checkpoint_id) references public.checkpoints (asset_id, id) on delete cascade;

-- Creates a direction and its entries in one transaction.
create function public.create_direction(
  p_project_id uuid, p_name text, p_description text, p_entries jsonb
) returns public.directions
language plpgsql security definer set search_path = '' as $$
declare
  d public.directions;
  entry jsonb;
begin
  if not public.can_edit_project(p_project_id) then
    raise exception 'only owners and editors can save directions' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'choose at least one document' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.directions (project_id, name, description, created_by)
    values (p_project_id, p_name, nullif(p_description, ''), auth.uid()) returning * into d;
  for entry in select * from jsonb_array_elements(p_entries) loop
    if not exists (
      select 1 from public.checkpoints c
       where c.id = (entry ->> 'checkpointId')::uuid and c.asset_id = (entry ->> 'assetId')::uuid
         and c.project_id = p_project_id and c.status = 'finalized'
         -- Unapproved candidates aren't part of history and can't be pinned.
         and (c.proposal_item_id is null or exists (
           select 1 from public.proposal_items i where i.id = c.proposal_item_id and i.status = 'finalized'))
    ) then
      raise exception 'each entry must be a finalized checkpoint of that document in this project'
        using errcode = 'foreign_key_violation';
    end if;
    insert into public.direction_entries (direction_id, asset_id, checkpoint_id)
      values (d.id, (entry ->> 'assetId')::uuid, (entry ->> 'checkpointId')::uuid);
  end loop;
  return d;
end $$;

revoke execute on function public.create_direction(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_direction(uuid, text, text, jsonb) to authenticated, service_role;
