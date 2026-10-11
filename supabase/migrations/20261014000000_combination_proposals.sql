-- Phase 5: selective combination and approval.
--
-- A branch_combination proposal is bound to exact base, target and source checkpoints and to
-- the user's choices. A createCandidate job builds the combined result from a copy of the
-- target snapshot. The candidate is a complete, immutable checkpoint whose parents are the
-- target and source heads, but it stays out of history until its proposal is approved.
-- Approval records the exact candidate and advances the target branch to it by
-- compare-and-swap, so the finalized artifact is the one that was previewed.

alter table public.checkpoints
  add column proposal_item_id uuid references public.proposal_items (id);
create index checkpoints_proposal_item_idx on public.checkpoints (proposal_item_id);

-- Creates the proposal, its single item and the candidate job in one transaction. The caller
-- (the web backend, acting as the signed-in user) computed the change set from the bound
-- checkpoints; this function re-checks permissions and that the checkpoints belong together.
create function public.create_combination_proposal(
  p_project_id uuid,
  p_asset_id uuid,
  p_request jsonb,
  p_operation_id text,
  p_job_params jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target_branch public.branches;
  ids uuid[];
  n integer;
  proposal public.proposals;
  item public.proposal_items;
  job public.jobs;
begin
  if not public.can_edit_project(p_project_id) then
    raise exception 'only owners and editors can propose combinations' using errcode = 'insufficient_privilege';
  end if;
  select * into target_branch from public.branches
   where id = (p_request ->> 'targetBranchId')::uuid and asset_id = p_asset_id;
  if not found then
    raise exception 'target branch is not on this asset' using errcode = 'foreign_key_violation';
  end if;
  if target_branch.head_checkpoint_id <> (p_request ->> 'targetCheckpointId')::uuid then
    raise exception 'the target branch moved; review the combination again'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  ids := array[(p_request ->> 'baseCheckpointId')::uuid, (p_request ->> 'targetCheckpointId')::uuid,
               (p_request ->> 'sourceCheckpointId')::uuid];
  select count(distinct id) into n from public.checkpoints
   where id = any (ids) and asset_id = p_asset_id and project_id = p_project_id and status = 'finalized';
  if n <> (select count(distinct x) from unnest(ids) x) then
    raise exception 'base, target and source must be finalized checkpoints of this asset'
      using errcode = 'foreign_key_violation';
  end if;

  -- Repeated delivery of the same request returns the original proposal.
  select p.* into proposal from public.proposals p
    join public.jobs j on j.params ->> 'proposalId' = p.id::text
   where j.operation_id = p_operation_id;
  if found then
    select * into item from public.proposal_items where proposal_id = proposal.id;
    select * into job from public.jobs where operation_id = p_operation_id;
    return jsonb_build_object('proposal', to_jsonb(proposal), 'item', to_jsonb(item), 'job', to_jsonb(job));
  end if;

  insert into public.proposals (project_id, kind, status, request, created_by)
    values (p_project_id, 'branch_combination', 'preparing', p_request, auth.uid())
    returning * into proposal;
  insert into public.proposal_items (proposal_id, asset_id, source_checkpoint_ids, status)
    values (proposal.id, p_asset_id,
            array[(p_request ->> 'targetCheckpointId')::uuid, (p_request ->> 'sourceCheckpointId')::uuid],
            'running')
    returning * into item;
  job := public.create_job(
    p_project_id, p_asset_id, 'createCandidate', p_operation_id,
    p_job_params || jsonb_build_object(
      'proposalId', proposal.id,
      'proposalItemId', item.id,
      'parentIds', jsonb_build_array(p_request ->> 'targetCheckpointId', p_request ->> 'sourceCheckpointId')),
    false);
  return jsonb_build_object('proposal', to_jsonb(proposal), 'item', to_jsonb(item), 'job', to_jsonb(job));
end $$;

-- Candidate jobs take their parents from the job (set by the backend), never from the
-- connector, and tag the checkpoint with its proposal item. Captures behave as in Phase 4.
create or replace function public.begin_checkpoint(
  p_session_id uuid, p_job_id uuid, p_manifest jsonb, p_parent_ids uuid[] default '{}', p_message text default null
) returns public.checkpoints
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  s public.connector_sessions;
  c public.checkpoints;
  parents uuid[] := coalesce(p_parent_ids, '{}');
  head uuid;
  parent uuid;
  candidate boolean;
begin
  s := public.require_active_session(p_session_id);
  select * into j from public.jobs where id = p_job_id;
  if not found or j.status <> 'leased' or j.lease_session_id <> s.id then
    raise exception 'session does not hold the lease for job %', p_job_id using errcode = 'lock_not_available';
  end if;
  if j.asset_id is null then
    raise exception 'job % has no asset', p_job_id using errcode = 'check_violation';
  end if;
  candidate := j.operation = 'createCandidate';

  insert into public.checkpoints (project_id, asset_id, operation_id, manifest, message, created_by, session_id,
                                  proposal_item_id)
  values (j.project_id, j.asset_id, j.operation_id, p_manifest, coalesce(p_message, j.params ->> 'message'),
          s.user_id, s.id, case when candidate then (j.params ->> 'proposalItemId')::uuid end)
  on conflict (operation_id) do nothing
  returning * into c;

  if c.id is null then
    select * into c from public.checkpoints where operation_id = j.operation_id;
    return c;
  end if;

  if candidate then
    select coalesce(array_agg(x::uuid), '{}') into parents from jsonb_array_elements_text(j.params -> 'parentIds') x;
  elsif j.params ? 'branchId' then
    select head_checkpoint_id into head from public.branches
     where id = (j.params ->> 'branchId')::uuid and asset_id = j.asset_id;
    if head is not null and not head = any (parents) then
      parents := parents || head;
    end if;
  end if;

  foreach parent in array parents loop
    insert into public.checkpoint_parents (asset_id, checkpoint_id, parent_id) values (j.asset_id, c.id, parent);
  end loop;
  return c;
end $$;

-- Candidates never advance a branch or create "main"; approval does that.
create or replace function public.finalize_checkpoint(p_session_id uuid, p_checkpoint_id uuid)
returns public.checkpoints
language plpgsql security definer set search_path = '' as $$
declare
  c public.checkpoints;
  j public.jobs;
  branch_id uuid;
  parent uuid;
  advanced boolean := false;
  outcome jsonb;
begin
  perform public.require_active_session(p_session_id);
  select * into c from public.checkpoints where id = p_checkpoint_id for update;
  if not found or c.session_id is distinct from p_session_id then
    raise exception 'checkpoint not found for this session' using errcode = 'no_data_found';
  end if;
  select * into j from public.jobs where operation_id = c.operation_id for update;
  outcome := jsonb_build_object('checkpointId', c.id);

  if c.status = 'pending' then
    if c.native_path is null or c.preview_path is null then
      raise exception 'checkpoint % is missing files', c.id using errcode = 'check_violation';
    end if;
    if c.native_digest <> c.manifest #>> '{files,native,digest}'
       or c.preview_digest <> c.manifest #>> '{files,preview,digest}' then
      raise exception 'checkpoint % files do not match its manifest', c.id using errcode = 'check_violation';
    end if;
    update public.checkpoints set status = 'finalized', finalized_at = now() where id = c.id returning * into c;

    if c.proposal_item_id is not null then
      null;  -- candidate: the proposal trigger records it; branches move only on approval
    elsif j.id is not null and j.params ? 'branchId' then
      branch_id := (j.params ->> 'branchId')::uuid;
      select parent_id into parent from public.checkpoint_parents where checkpoint_id = c.id limit 1;
      update public.branches set head_checkpoint_id = c.id, updated_at = now()
       where id = branch_id and asset_id = c.asset_id and head_checkpoint_id is not distinct from parent;
      advanced := found;
      outcome := outcome || jsonb_build_object('branchId', branch_id, 'branchAdvanced', advanced);
    elsif not exists (select 1 from public.branches where asset_id = c.asset_id) then
      insert into public.branches (asset_id, name, head_checkpoint_id, created_by)
        values (c.asset_id, 'main', c.id, c.created_by) returning id into branch_id;
      update public.assets set active_branch_id = branch_id where id = c.asset_id and active_branch_id is null;
      outcome := outcome || jsonb_build_object('branchId', branch_id, 'branchAdvanced', true);
    else
      outcome := outcome || jsonb_build_object('branchId', null, 'branchAdvanced', false);
    end if;
  end if;

  if j.id is not null and j.status = 'leased' and j.lease_session_id = p_session_id then
    update public.jobs set status = 'succeeded', result = outcome where id = j.id;
  end if;
  return c;
end $$;

-- Keeps proposals in step with their candidate jobs.
create function public.track_candidate_job() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  item_id uuid := (new.params ->> 'proposalItemId')::uuid;
  proposal_id uuid := (new.params ->> 'proposalId')::uuid;
begin
  if new.operation <> 'createCandidate' or new.status = old.status or item_id is null then
    return null;
  end if;
  if new.status = 'succeeded' then
    update public.proposal_items
       set candidate_checkpoint_id = (new.result ->> 'checkpointId')::uuid, status = 'ready', outcome = null
     where id = item_id and status = 'running';
    update public.proposals set status = 'ready' where id = proposal_id and status = 'preparing';
  elsif new.status = 'failed' then
    update public.proposal_items set status = 'failed', outcome = jsonb_build_object('error', new.error)
     where id = item_id and status = 'running';
    update public.proposals set status = 'failed' where id = proposal_id and status = 'preparing';
  end if;
  return null;
end $$;

create trigger jobs_track_candidate after update of status on public.jobs
  for each row execute function public.track_candidate_job();

-- Records approval of the exact candidate and finalizes it: the target branch advances to the
-- candidate only if it still points at the target checkpoint the proposal was built from.
create function public.approve_proposal(p_proposal_id uuid, p_candidate_checkpoint_id uuid)
returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare
  p public.proposals;
  item public.proposal_items;
  c public.checkpoints;
begin
  select * into p from public.proposals where id = p_proposal_id for update;
  if not found or not public.is_project_member(p.project_id) then
    raise exception 'proposal not found' using errcode = 'no_data_found';
  end if;
  if not public.can_edit_project(p.project_id) then
    raise exception 'only owners and editors can approve' using errcode = 'insufficient_privilege';
  end if;
  if p.status <> 'ready' then
    raise exception 'proposal is %, not ready for approval', p.status using errcode = 'object_not_in_prerequisite_state';
  end if;
  select * into item from public.proposal_items where proposal_id = p.id for update;
  if item.candidate_checkpoint_id is distinct from p_candidate_checkpoint_id then
    raise exception 'the candidate changed; review the current preview before approving'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  select * into c from public.checkpoints where id = p_candidate_checkpoint_id and status = 'finalized';
  if not found then
    raise exception 'candidate is not a finalized checkpoint' using errcode = 'object_not_in_prerequisite_state';
  end if;

  update public.branches set head_checkpoint_id = c.id, updated_at = now()
   where id = (p.request ->> 'targetBranchId')::uuid and asset_id = item.asset_id
     and head_checkpoint_id = (p.request ->> 'targetCheckpointId')::uuid;
  if not found then
    raise exception 'the target branch moved since this candidate was made; combine again'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update public.proposal_items
     set status = 'finalized',
         outcome = jsonb_build_object(
           'approvedCandidateId', c.id,
           'nativeDigest', c.native_digest,
           'previewDigest', c.preview_digest,
           'approvedBy', auth.uid(),
           'approvedAt', now())
   where id = item.id;
  update public.proposals set status = 'finalized', approved_by = auth.uid(), approved_at = now()
   where id = p.id returning * into p;
  return p;
end $$;

create function public.reject_proposal(p_proposal_id uuid) returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare
  p public.proposals;
begin
  select * into p from public.proposals where id = p_proposal_id for update;
  if not found or not public.is_project_member(p.project_id) then
    raise exception 'proposal not found' using errcode = 'no_data_found';
  end if;
  if not public.can_edit_project(p.project_id) then
    raise exception 'only owners and editors can discard proposals' using errcode = 'insufficient_privilege';
  end if;
  if p.status not in ('draft', 'preparing', 'ready', 'failed') then
    raise exception 'proposal is % and cannot be discarded', p.status using errcode = 'object_not_in_prerequisite_state';
  end if;
  update public.proposals set status = 'rejected' where id = p.id returning * into p;
  return p;
end $$;

revoke execute on function public.create_combination_proposal(uuid, uuid, jsonb, text, jsonb) from public, anon;
revoke execute on function public.approve_proposal(uuid, uuid) from public, anon;
revoke execute on function public.reject_proposal(uuid) from public, anon;
revoke execute on function public.track_candidate_job() from public, anon, authenticated;
grant execute on function public.create_combination_proposal(uuid, uuid, jsonb, text, jsonb) to authenticated, service_role;
grant execute on function public.approve_proposal(uuid, uuid) to authenticated, service_role;
grant execute on function public.reject_proposal(uuid) to authenticated, service_role;
grant execute on function public.begin_checkpoint(uuid, uuid, jsonb, uuid[], text) to service_role;
grant execute on function public.finalize_checkpoint(uuid, uuid) to service_role;
revoke execute on function public.begin_checkpoint(uuid, uuid, jsonb, uuid[], text) from public, anon, authenticated;
revoke execute on function public.finalize_checkpoint(uuid, uuid) from public, anon, authenticated;
