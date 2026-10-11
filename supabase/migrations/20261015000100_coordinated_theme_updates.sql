-- Phase 6: coordinated updates (a theme applied across several assets).
--
-- A coordinated_update proposal has one item per asset. Included assets get a
-- createCandidate job each (the same job as branch combination, with the asset's branch head
-- as the only parent); assets that can't take the change are recorded as excluded with a
-- reason. Items finish independently, so the proposal's status is derived from its items and
-- a partial result is never shown as complete. Approval finalizes chosen items one by one
-- (compare-and-swap per branch); failed items can be retried on their own.

-- Proposal status from its items. Discarded proposals keep their status.
create function public.refresh_proposal_status(p_proposal_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  counts record;
  next_status text;
begin
  select count(*) filter (where status in ('pending', 'running')) as running,
         count(*) filter (where status = 'ready') as ready,
         count(*) filter (where status = 'failed') as failed,
         count(*) filter (where status = 'finalized') as finalized,
         count(*) filter (where status <> 'excluded') as included
    into counts
    from public.proposal_items where proposal_id = p_proposal_id;

  next_status := case
    when counts.running > 0 then 'preparing'
    when counts.included = 0 then 'failed'
    when counts.failed = 0 and counts.ready = 0 then 'finalized'
    when counts.failed > 0 and counts.ready = 0 and counts.finalized = 0 then 'failed'
    when counts.failed > 0 then 'partially_failed'
    else 'ready'
  end;
  update public.proposals set status = next_status
   where id = p_proposal_id and status not in ('rejected') and status <> next_status;
end $$;

-- Candidate jobs update their item; the proposal status follows from all items.
create or replace function public.track_candidate_job() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  item_id uuid := (new.params ->> 'proposalItemId')::uuid;
begin
  if new.operation <> 'createCandidate' or new.status = old.status or item_id is null then
    return null;
  end if;
  if new.status = 'succeeded' then
    update public.proposal_items
       set candidate_checkpoint_id = (new.result ->> 'checkpointId')::uuid, status = 'ready', outcome = null
     where id = item_id and status = 'running';
  elsif new.status = 'failed' then
    update public.proposal_items set status = 'failed', outcome = jsonb_build_object('error', new.error)
     where id = item_id and status = 'running';
  else
    return null;
  end if;
  perform public.refresh_proposal_status((new.params ->> 'proposalId')::uuid);
  return null;
end $$;

-- Creates a coordinated proposal with one item per asset in one transaction. p_items is
-- [{assetId, include, jobParams?, reason?}]; included items get a candidate job built from
-- jobParams (which must name the branch head as targetCheckpoint), excluded ones a reason.
create function public.create_coordinated_proposal(p_project_id uuid, p_request jsonb, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  proposal public.proposals;
  item public.proposal_items;
  entry jsonb;
  item_asset uuid;
  head uuid;
  created jsonb := '[]'::jsonb;
  job public.jobs;
begin
  if not public.can_edit_project(p_project_id) then
    raise exception 'only owners and editors can apply themes' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'choose at least one asset' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.proposals (project_id, kind, status, request, created_by)
    values (p_project_id, 'coordinated_update', 'preparing', p_request, auth.uid())
    returning * into proposal;

  for entry in select * from jsonb_array_elements(p_items) loop
    item_asset := (entry ->> 'assetId')::uuid;
    if not exists (select 1 from public.assets where id = item_asset and project_id = p_project_id) then
      raise exception 'asset % is not in this project', item_asset using errcode = 'foreign_key_violation';
    end if;

    if coalesce((entry ->> 'include')::boolean, false) then
      head := (entry #>> '{jobParams,targetCheckpoint,id}')::uuid;
      if not exists (
        select 1 from public.branches b join public.assets a on a.active_branch_id = b.id
         where a.id = item_asset and b.head_checkpoint_id = head
      ) then
        raise exception 'the branch of asset % moved; review the theme again', item_asset
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      insert into public.proposal_items (proposal_id, asset_id, source_checkpoint_ids, status)
        values (proposal.id, item_asset, array[head], 'running') returning * into item;
      job := public.create_job(
        p_project_id, item_asset, 'createCandidate', 'theme-' || item.id::text,
        (entry -> 'jobParams') || jsonb_build_object(
          'proposalId', proposal.id, 'proposalItemId', item.id, 'parentIds', jsonb_build_array(head)),
        false);
    else
      insert into public.proposal_items (proposal_id, asset_id, status, outcome)
        values (proposal.id, item_asset, 'excluded', jsonb_build_object('reason', entry ->> 'reason'))
        returning * into item;
    end if;
    created := created || jsonb_build_array(to_jsonb(item));
  end loop;

  perform public.refresh_proposal_status(proposal.id);
  select * into proposal from public.proposals where id = proposal.id;
  return jsonb_build_object('proposal', to_jsonb(proposal), 'items', created);
end $$;

-- Rebuilds one failed (or stale) item with fresh job parameters, leaving the others alone.
create function public.retry_proposal_item(p_item_id uuid, p_job_params jsonb) returns public.proposal_items
language plpgsql security definer set search_path = '' as $$
declare
  item public.proposal_items;
  p public.proposals;
  head uuid := (p_job_params #>> '{targetCheckpoint,id}')::uuid;
begin
  select * into item from public.proposal_items where id = p_item_id for update;
  if not found then
    raise exception 'proposal item not found' using errcode = 'no_data_found';
  end if;
  select * into p from public.proposals where id = item.proposal_id for update;
  if not public.can_edit_project(p.project_id) then
    raise exception 'only owners and editors can retry' using errcode = 'insufficient_privilege';
  end if;
  if p.kind <> 'coordinated_update' or p.status = 'rejected' or item.status <> 'failed' then
    raise exception 'only failed items of an open theme update can be retried'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update public.proposal_items
     set status = 'running', candidate_checkpoint_id = null, outcome = null, source_checkpoint_ids = array[head]
   where id = item.id returning * into item;
  perform public.create_job(
    p.project_id, item.asset_id, 'createCandidate', 'theme-' || item.id::text || '-' || gen_random_uuid()::text,
    p_job_params || jsonb_build_object('proposalId', p.id, 'proposalItemId', item.id, 'parentIds', jsonb_build_array(head)),
    false);
  perform public.refresh_proposal_status(p.id);
  return item;
end $$;

-- Approves exactly the listed candidates ([{itemId, candidateCheckpointId}]) and finalizes each
-- on its asset's branch if that branch still points at the version the candidate was built
-- from; otherwise that item fails as stale and can be retried. Other ready items are excluded.
create function public.approve_proposal_items(p_proposal_id uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.proposals;
  item public.proposal_items;
  entry jsonb;
  c public.checkpoints;
  approved uuid[] := '{}';
  results jsonb := '[]'::jsonb;
  branch_id uuid;
begin
  select * into p from public.proposals where id = p_proposal_id for update;
  if not found or not public.is_project_member(p.project_id) then
    raise exception 'proposal not found' using errcode = 'no_data_found';
  end if;
  if not public.can_edit_project(p.project_id) then
    raise exception 'only owners and editors can approve' using errcode = 'insufficient_privilege';
  end if;
  if p.kind <> 'coordinated_update' or p.status not in ('ready', 'partially_failed') then
    raise exception 'proposal is %, not ready for approval', p.status using errcode = 'object_not_in_prerequisite_state';
  end if;

  for entry in select * from jsonb_array_elements(p_items) loop
    select * into item from public.proposal_items
     where id = (entry ->> 'itemId')::uuid and proposal_id = p.id for update;
    if not found or item.status <> 'ready'
       or item.candidate_checkpoint_id is distinct from (entry ->> 'candidateCheckpointId')::uuid then
      raise exception 'a candidate changed or is not ready; review the current previews before approving'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    select * into c from public.checkpoints where id = item.candidate_checkpoint_id and status = 'finalized';
    select a.active_branch_id into branch_id from public.assets a where a.id = item.asset_id;

    update public.branches set head_checkpoint_id = c.id, updated_at = now()
     where id = branch_id and head_checkpoint_id = item.source_checkpoint_ids[1];
    if found then
      update public.proposal_items
         set status = 'finalized',
             outcome = jsonb_build_object('approvedCandidateId', c.id, 'nativeDigest', c.native_digest,
                                          'previewDigest', c.preview_digest, 'approvedBy', auth.uid(),
                                          'approvedAt', now(), 'branchId', branch_id)
       where id = item.id;
      results := results || jsonb_build_array(jsonb_build_object('itemId', item.id, 'status', 'finalized'));
    else
      update public.proposal_items
         set status = 'failed',
             outcome = jsonb_build_object('error', jsonb_build_object(
               'code', 'STALE', 'message', 'The document''s branch moved since the preview was made; retry it'))
       where id = item.id;
      results := results || jsonb_build_array(jsonb_build_object('itemId', item.id, 'status', 'failed'));
    end if;
    approved := approved || item.id;
  end loop;

  update public.proposal_items
     set status = 'excluded', outcome = jsonb_build_object('reason', 'Not chosen at approval')
   where proposal_id = p.id and status = 'ready' and not id = any (approved);

  update public.proposals set approved_by = auth.uid(), approved_at = now() where id = p.id;
  perform public.refresh_proposal_status(p.id);
  select * into p from public.proposals where id = p.id;
  return jsonb_build_object('proposal', to_jsonb(p), 'items', results);
end $$;

revoke execute on function public.refresh_proposal_status(uuid) from public, anon, authenticated;
revoke execute on function public.create_coordinated_proposal(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.retry_proposal_item(uuid, jsonb) from public, anon;
revoke execute on function public.approve_proposal_items(uuid, jsonb) from public, anon;
grant execute on function public.create_coordinated_proposal(uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.retry_proposal_item(uuid, jsonb) to authenticated, service_role;
grant execute on function public.approve_proposal_items(uuid, jsonb) to authenticated, service_role;
grant execute on function public.refresh_proposal_status(uuid) to service_role;
