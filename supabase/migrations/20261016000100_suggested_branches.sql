-- Phase 8 (AI assistant): suggested branches.
--
-- A suggestion the user chose to try becomes a 'suggested_branch' proposal with one item: a
-- candidate built from the document's current version by the usual createCandidate job (the
-- version is its only parent). Keeping it creates a new branch at that exact candidate; no
-- existing branch moves. The suggestion text is stored in the request for the record.

alter table public.proposals drop constraint proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check
  check (kind in ('branch_combination', 'coordinated_update', 'suggested_branch'));

create function public.create_suggestion_proposal(
  p_project_id uuid, p_asset_id uuid, p_request jsonb, p_job_params jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  head uuid := (p_job_params #>> '{targetCheckpoint,id}')::uuid;
  proposal public.proposals;
  item public.proposal_items;
  job public.jobs;
begin
  if not public.can_edit_project(p_project_id) then
    raise exception 'only owners and editors can try suggestions' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.checkpoints c
     where c.id = head and c.asset_id = p_asset_id and c.project_id = p_project_id and c.status = 'finalized'
  ) then
    raise exception 'the suggestion must start from a finalized version of this document'
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.proposals (project_id, kind, status, request, created_by)
    values (p_project_id, 'suggested_branch', 'preparing', p_request, auth.uid()) returning * into proposal;
  insert into public.proposal_items (proposal_id, asset_id, source_checkpoint_ids, status)
    values (proposal.id, p_asset_id, array[head], 'running') returning * into item;
  job := public.create_job(
    p_project_id, p_asset_id, 'createCandidate', 'suggestion-' || item.id::text,
    p_job_params || jsonb_build_object('proposalId', proposal.id, 'proposalItemId', item.id,
                                       'parentIds', jsonb_build_array(head)),
    false);
  return jsonb_build_object('proposal', to_jsonb(proposal), 'item', to_jsonb(item), 'job', to_jsonb(job));
end $$;

-- Keeps the exact reviewed candidate as a new branch.
create function public.keep_suggestion(p_proposal_id uuid, p_candidate_checkpoint_id uuid, p_branch_name text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.proposals;
  item public.proposal_items;
  c public.checkpoints;
  b public.branches;
begin
  select * into p from public.proposals where id = p_proposal_id for update;
  if not found or not public.is_project_member(p.project_id) then
    raise exception 'proposal not found' using errcode = 'no_data_found';
  end if;
  if not public.can_edit_project(p.project_id) then
    raise exception 'only owners and editors can keep suggestions' using errcode = 'insufficient_privilege';
  end if;
  if p.kind <> 'suggested_branch' or p.status <> 'ready' then
    raise exception 'this suggestion is %, not ready to keep', p.status using errcode = 'object_not_in_prerequisite_state';
  end if;
  select * into item from public.proposal_items where proposal_id = p.id for update;
  if item.candidate_checkpoint_id is distinct from p_candidate_checkpoint_id then
    raise exception 'the candidate changed; review the current preview first'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  select * into c from public.checkpoints where id = p_candidate_checkpoint_id and status = 'finalized';

  insert into public.branches (asset_id, name, head_checkpoint_id, created_by)
    values (item.asset_id, p_branch_name, c.id, auth.uid()) returning * into b;
  update public.proposal_items
     set status = 'finalized',
         outcome = jsonb_build_object('approvedCandidateId', c.id, 'nativeDigest', c.native_digest,
                                      'previewDigest', c.preview_digest, 'approvedBy', auth.uid(),
                                      'approvedAt', now(), 'branchId', b.id)
   where id = item.id;
  update public.proposals set status = 'finalized', approved_by = auth.uid(), approved_at = now()
   where id = p.id returning * into p;
  return jsonb_build_object('proposal', to_jsonb(p), 'branch', to_jsonb(b));
end $$;

revoke execute on function public.create_suggestion_proposal(uuid, uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.keep_suggestion(uuid, uuid, text) from public, anon;
grant execute on function public.create_suggestion_proposal(uuid, uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.keep_suggestion(uuid, uuid, text) to authenticated, service_role;
