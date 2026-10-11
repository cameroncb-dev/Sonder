-- Phase 4: active branches, branch-aware captures and checkout.
--
-- Captures attach to the asset's active branch: the new checkpoint's parent is
-- the branch head when the capture begins, and the head advances on finalize
-- only if it still points at that parent (compare-and-swap). Switching the
-- active branch happens only through a successful openCheckpoint job, so the
-- document a connector edits always descends from the active branch head.

alter table public.branches add constraint branches_id_asset_key unique (id, asset_id);

alter table public.assets add column active_branch_id uuid;
alter table public.assets
  add constraint assets_active_branch_fk foreign key (active_branch_id, id)
  references public.branches (id, asset_id) on delete set null (active_branch_id);

-- Starts (or resumes) the checkpoint for a leased job. For captures on a
-- branch, the parent is that branch's head at this moment.
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
begin
  s := public.require_active_session(p_session_id);
  select * into j from public.jobs where id = p_job_id;
  if not found or j.status <> 'leased' or j.lease_session_id <> s.id then
    raise exception 'session does not hold the lease for job %', p_job_id using errcode = 'lock_not_available';
  end if;
  if j.asset_id is null then
    raise exception 'job % has no asset', p_job_id using errcode = 'check_violation';
  end if;

  insert into public.checkpoints (project_id, asset_id, operation_id, manifest, message, created_by, session_id)
  values (j.project_id, j.asset_id, j.operation_id, p_manifest, coalesce(p_message, j.params ->> 'message'), s.user_id, s.id)
  on conflict (operation_id) do nothing
  returning * into c;

  if c.id is null then
    select * into c from public.checkpoints where operation_id = j.operation_id;
    return c;
  end if;

  if j.params ? 'branchId' then
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

-- Finalizes once both files match the manifest, advances the capture's branch
-- (or creates "main" for an asset's first checkpoint), and completes the job,
-- all in one transaction. Idempotent.
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

    if j.id is not null and j.params ? 'branchId' then
      branch_id := (j.params ->> 'branchId')::uuid;
      select parent_id into parent from public.checkpoint_parents where checkpoint_id = c.id limit 1;
      update public.branches set head_checkpoint_id = c.id, updated_at = now()
       where id = branch_id and asset_id = c.asset_id and head_checkpoint_id is not distinct from parent;
      advanced := found;
    elsif not exists (select 1 from public.branches where asset_id = c.asset_id) then
      insert into public.branches (asset_id, name, head_checkpoint_id, created_by)
        values (c.asset_id, 'main', c.id, c.created_by) returning id into branch_id;
      update public.assets set active_branch_id = branch_id where id = c.asset_id and active_branch_id is null;
      advanced := true;
    end if;
    outcome := outcome || jsonb_build_object('branchId', branch_id, 'branchAdvanced', advanced);
  end if;

  if j.id is not null and j.status = 'leased' and j.lease_session_id = p_session_id then
    update public.jobs set status = 'succeeded', result = outcome where id = j.id;
  end if;
  return c;
end $$;

-- A successful checkout makes the branch active and points the asset at the
-- working copy the connector opened.
create function public.apply_checkout() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.operation = 'openCheckpoint' and new.status = 'succeeded' and old.status <> 'succeeded'
     and new.params ? 'branchId' and new.result ? 'path' then
    update public.assets
       set active_branch_id = (new.params ->> 'branchId')::uuid,
           native_locator = jsonb_set(native_locator, '{path}', new.result -> 'path')
     where id = new.asset_id;
  end if;
  return null;
end $$;

create trigger jobs_apply_checkout after update of status on public.jobs
  for each row execute function public.apply_checkout();

-- Optimistic concurrency for canvas saves: bump the version on every change.
create function public.bump_canvas_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.version <> old.version + 1 then
    raise exception 'canvas item % changed since version %', old.id, new.version - 1
      using errcode = 'check_violation';  -- not 40001: PostgREST retries serialization failures
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger canvas_items_version before update on public.canvas_items
  for each row execute function public.bump_canvas_version();

revoke execute on function public.apply_checkout() from public, anon, authenticated;
grant execute on function public.begin_checkpoint(uuid, uuid, jsonb, uuid[], text) to service_role;
grant execute on function public.finalize_checkpoint(uuid, uuid) to service_role;
revoke execute on function public.begin_checkpoint(uuid, uuid, jsonb, uuid[], text) from public, anon, authenticated;
revoke execute on function public.finalize_checkpoint(uuid, uuid) from public, anon, authenticated;
