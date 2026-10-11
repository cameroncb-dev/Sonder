-- Phase 3: connector jobs, leases, retries, reconciliation and checkpoint registration.
--
-- Connector-facing functions take an explicit session id and are callable only
-- by the backend (service role). The backend authenticates the connector token
-- before calling them; the functions re-check session validity and membership.

create type public.job_status as enum ('queued', 'leased', 'succeeded', 'failed', 'cancelled');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  asset_id uuid references public.assets (id) on delete cascade,
  application text not null check (application ~ '^[a-z][a-z0-9_-]{0,63}$'),
  operation text not null check (operation ~ '^[a-zA-Z]{1,64}$'),
  -- Unique operation id: the idempotency key for the job and anything it creates.
  operation_id text not null unique check (char_length(operation_id) between 8 and 200),
  params jsonb not null default '{}'::jsonb,
  -- When true, only a session that currently has the asset's document open may run it.
  requires_asset_session boolean not null default true,
  status public.job_status not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_session_id uuid references public.connector_sessions (id) on delete set null,
  lease_expires_at timestamptz,
  result jsonb,
  error jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (asset_id is not null or not requires_asset_session),
  check (status <> 'leased' or (lease_session_id is not null and lease_expires_at is not null))
);
create index jobs_queue_idx on public.jobs (status, application, created_at);

create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  from_status public.job_status,
  to_status public.job_status not null,
  session_id uuid,
  attempt integer not null,
  detail jsonb,
  at timestamptz not null default now()
);
create index job_events_job_idx on public.job_events (job_id, id);

-- Explicit status transitions (validated before the write) and an audit trail
-- in job_events (written after it, once the job row exists).
create function public.guard_job_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' then
      raise exception 'jobs must start queued' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = old.status then
    if new.status in ('succeeded', 'failed', 'cancelled') and new is distinct from old then
      raise exception 'job % is terminal', old.id using errcode = 'check_violation';
    end if;
  elsif (old.status, new.status) not in (
    ('queued'::public.job_status, 'leased'::public.job_status),
    ('queued', 'cancelled'),
    ('leased', 'succeeded'),
    ('leased', 'failed'),
    ('leased', 'queued')
  ) then
    raise exception 'invalid job transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

create function public.log_job_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.job_events (job_id, from_status, to_status, attempt) values (new.id, null, new.status, 0);
  elsif new.status <> old.status then
    insert into public.job_events (job_id, from_status, to_status, session_id, attempt, detail)
      values (new.id, old.status, new.status, coalesce(new.lease_session_id, old.lease_session_id), new.attempts,
              case when new.status = 'succeeded' then new.result else new.error end);
  end if;
  return null;
end $$;

create trigger jobs_transition before insert or update on public.jobs
  for each row execute function public.guard_job_transition();
create trigger jobs_transition_log after insert or update on public.jobs
  for each row execute function public.log_job_transition();

alter table public.jobs enable row level security;
alter table public.job_events enable row level security;
create policy "members read jobs" on public.jobs for select to authenticated
  using (public.is_project_member(project_id));
create policy "members read job events" on public.job_events for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and public.is_project_member(j.project_id)));

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function public.user_can_edit(p_user_id uuid, p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id and role in ('owner', 'editor')
  );
$$;

-- Returns the session if it is active and unexpired; raises otherwise.
create function public.require_active_session(p_session_id uuid) returns public.connector_sessions
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.connector_sessions;
begin
  select * into s from public.connector_sessions where id = p_session_id;
  if not found or s.status <> 'active' or s.expires_at is null or s.expires_at <= now() then
    raise exception 'connector session is not active' using errcode = 'insufficient_privilege';
  end if;
  return s;
end $$;

-- ---------------------------------------------------------------------------
-- User-facing (called with the user's JWT; authorization checked here too)
-- ---------------------------------------------------------------------------

-- Idempotent on operation_id: re-submitting returns the existing job unchanged.
create function public.create_job(
  p_project_id uuid,
  p_asset_id uuid,
  p_operation text,
  p_operation_id text,
  p_params jsonb default '{}'::jsonb,
  p_requires_asset_session boolean default true,
  p_max_attempts integer default 3
) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  a public.assets;
  result public.jobs;
begin
  if not public.can_edit_project(p_project_id) then
    raise exception 'only owners and editors can create jobs' using errcode = 'insufficient_privilege';
  end if;
  if p_asset_id is not null then
    select * into a from public.assets where id = p_asset_id and project_id = p_project_id;
    if not found then
      raise exception 'asset % is not in project %', p_asset_id, p_project_id using errcode = 'foreign_key_violation';
    end if;
  end if;

  insert into public.jobs (project_id, asset_id, application, operation, operation_id, params,
                           requires_asset_session, max_attempts, created_by)
  values (p_project_id, p_asset_id, coalesce(a.application, p_params ->> 'application'), p_operation,
          p_operation_id, coalesce(p_params, '{}'::jsonb), p_requires_asset_session, p_max_attempts, auth.uid())
  on conflict (operation_id) do nothing
  returning * into result;

  if result.id is null then
    select * into result from public.jobs where operation_id = p_operation_id;
    if result.project_id <> p_project_id or result.operation <> p_operation
       or result.asset_id is distinct from p_asset_id then
      raise exception 'operation id % is already used by a different job', p_operation_id
        using errcode = 'unique_violation';
    end if;
  end if;
  return result;
end $$;

create function public.approve_pairing(p_code text) returns public.connector_sessions
language plpgsql security definer set search_path = '' as $$
declare
  s public.connector_sessions;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  update public.connector_sessions
     set user_id = auth.uid(), status = 'approved'
   where pairing_code = upper(p_code) and status = 'pending' and pairing_expires_at > now()
  returning * into s;
  if not found then
    raise exception 'pairing code is invalid or expired' using errcode = 'no_data_found';
  end if;
  s.pairing_secret_hash := null;
  s.token_hash := null;
  return s;
end $$;

-- ---------------------------------------------------------------------------
-- Connector-facing (service role only)
-- ---------------------------------------------------------------------------

-- Before a job whose lease expired is retried, check whether its side effect
-- (a finalized checkpoint with the same operation id) already exists.
create function public.reconcile_expired_jobs() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  cp_id uuid;
  n integer := 0;
begin
  for j in
    select * from public.jobs
     where status = 'leased' and lease_expires_at < now()
     for update skip locked
  loop
    select id into cp_id from public.checkpoints where operation_id = j.operation_id and status = 'finalized';
    if cp_id is not null then
      update public.jobs set status = 'succeeded',
             result = jsonb_build_object('checkpointId', cp_id, 'reconciled', true)
       where id = j.id;
    elsif j.attempts >= j.max_attempts then
      update public.jobs set status = 'failed',
             error = jsonb_build_object('code', 'LEASE_EXPIRED', 'message',
                     'Lease expired with no recorded result after ' || j.attempts || ' attempts', 'reconciled', true)
       where id = j.id;
    else
      update public.jobs set status = 'queued', lease_session_id = null, lease_expires_at = null,
             error = jsonb_build_object('code', 'LEASE_EXPIRED', 'message',
                     'Lease expired; no side effect found, retrying', 'reconciled', true)
       where id = j.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Claims the oldest compatible job for a session: same application, an
-- operation the connector declared, a project where the paired user can edit,
-- and (when required) an asset whose document this session has open.
create function public.claim_job(p_session_id uuid, p_lease_seconds integer default 120)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  s public.connector_sessions;
  j public.jobs;
begin
  s := public.require_active_session(p_session_id);
  perform public.reconcile_expired_jobs();

  select q.* into j from public.jobs q
   where q.status = 'queued'
     and q.application = s.application
     and q.operation in (select jsonb_array_elements_text(s.capabilities -> 'operations'))
     and public.user_can_edit(s.user_id, q.project_id)
     and (not q.requires_asset_session or exists (
           select 1 from public.session_assets sa
            where sa.session_id = s.id and sa.asset_id = q.asset_id
              and sa.reported_at > now() - interval '2 minutes'))
   order by q.created_at
   for update skip locked
   limit 1;

  if not found then
    return null;
  end if;

  update public.jobs
     set status = 'leased', lease_session_id = s.id,
         lease_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 900))),
         attempts = attempts + 1, error = null
   where id = j.id
  returning * into j;
  return j;
end $$;

-- The session must hold the job's lease. Completion is idempotent for the same session.
create function public.complete_job(p_session_id uuid, p_job_id uuid, p_result jsonb)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
begin
  perform public.require_active_session(p_session_id);
  select * into j from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;
  if j.status = 'succeeded' and j.lease_session_id = p_session_id then
    return j;
  end if;
  if j.status <> 'leased' or j.lease_session_id <> p_session_id then
    raise exception 'stale lease for job %', p_job_id using errcode = 'lock_not_available';
  end if;
  update public.jobs set status = 'succeeded', result = p_result where id = p_job_id returning * into j;
  return j;
end $$;

create function public.fail_job(p_session_id uuid, p_job_id uuid, p_error jsonb, p_retryable boolean)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
begin
  perform public.require_active_session(p_session_id);
  select * into j from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;
  if j.status = 'failed' and j.lease_session_id = p_session_id then
    return j;
  end if;
  if j.status <> 'leased' or j.lease_session_id <> p_session_id then
    raise exception 'stale lease for job %', p_job_id using errcode = 'lock_not_available';
  end if;
  if p_retryable and j.attempts < j.max_attempts then
    update public.jobs set status = 'queued', lease_session_id = null, lease_expires_at = null, error = p_error
     where id = p_job_id returning * into j;
  else
    update public.jobs set status = 'failed', error = p_error where id = p_job_id returning * into j;
  end if;
  return j;
end $$;

-- Records which project assets the session has open, matched by native locator path.
create function public.report_session_assets(p_session_id uuid, p_paths text[])
returns table (asset_id uuid, project_id uuid, path text)
language plpgsql security definer set search_path = '' as $$
declare
  s public.connector_sessions;
begin
  s := public.require_active_session(p_session_id);
  update public.connector_sessions set last_seen_at = now() where id = s.id;
  delete from public.session_assets where session_id = s.id;
  insert into public.session_assets (session_id, asset_id)
    select s.id, a.id from public.assets a
     where a.application = s.application
       and a.native_locator ->> 'path' = any (p_paths)
       and public.user_can_edit(s.user_id, a.project_id);
  return query
    select a.id, a.project_id, a.native_locator ->> 'path'
      from public.session_assets sa join public.assets a on a.id = sa.asset_id
     where sa.session_id = s.id;
end $$;

-- Starts (or resumes, on repeated delivery) the checkpoint for a leased job.
create function public.begin_checkpoint(
  p_session_id uuid, p_job_id uuid, p_manifest jsonb, p_parent_ids uuid[] default '{}', p_message text default null
) returns public.checkpoints
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  s public.connector_sessions;
  c public.checkpoints;
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
  values (j.project_id, j.asset_id, j.operation_id, p_manifest, p_message, s.user_id, s.id)
  on conflict (operation_id) do nothing
  returning * into c;

  if c.id is null then
    select * into c from public.checkpoints where operation_id = j.operation_id;
    return c;
  end if;

  foreach parent in array coalesce(p_parent_ids, '{}') loop
    insert into public.checkpoint_parents (asset_id, checkpoint_id, parent_id) values (j.asset_id, c.id, parent);
  end loop;
  return c;
end $$;

create function public.record_checkpoint_file(
  p_session_id uuid, p_checkpoint_id uuid, p_kind text, p_path text, p_bytes bigint, p_digest text
) returns public.checkpoints
language plpgsql security definer set search_path = '' as $$
declare
  c public.checkpoints;
begin
  perform public.require_active_session(p_session_id);
  select * into c from public.checkpoints where id = p_checkpoint_id for update;
  if not found or c.session_id is distinct from p_session_id then
    raise exception 'checkpoint not found for this session' using errcode = 'no_data_found';
  end if;
  if c.status = 'finalized' then
    return c;
  end if;
  if p_kind = 'native' then
    update public.checkpoints set native_path = p_path, native_bytes = p_bytes, native_digest = p_digest
     where id = c.id returning * into c;
  elsif p_kind = 'preview' then
    update public.checkpoints set preview_path = p_path, preview_bytes = p_bytes, preview_digest = p_digest
     where id = c.id returning * into c;
  else
    raise exception 'unknown file kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;
  return c;
end $$;

-- Finalizes a checkpoint once both files are stored and match the manifest,
-- and completes its job in the same transaction. Idempotent.
create function public.finalize_checkpoint(p_session_id uuid, p_checkpoint_id uuid)
returns public.checkpoints
language plpgsql security definer set search_path = '' as $$
declare
  c public.checkpoints;
  j public.jobs;
begin
  perform public.require_active_session(p_session_id);
  select * into c from public.checkpoints where id = p_checkpoint_id for update;
  if not found or c.session_id is distinct from p_session_id then
    raise exception 'checkpoint not found for this session' using errcode = 'no_data_found';
  end if;

  if c.status = 'pending' then
    if c.native_path is null or c.preview_path is null then
      raise exception 'checkpoint % is missing files', c.id using errcode = 'check_violation';
    end if;
    if c.native_digest <> c.manifest #>> '{files,native,digest}'
       or c.preview_digest <> c.manifest #>> '{files,preview,digest}' then
      raise exception 'checkpoint % files do not match its manifest', c.id using errcode = 'check_violation';
    end if;
    update public.checkpoints set status = 'finalized', finalized_at = now() where id = c.id returning * into c;
  end if;

  select * into j from public.jobs where operation_id = c.operation_id for update;
  if found and j.status = 'leased' and j.lease_session_id = p_session_id then
    update public.jobs set status = 'succeeded', result = jsonb_build_object('checkpointId', c.id) where id = j.id;
  end if;
  return c;
end $$;

-- Connector-facing functions are not callable from the client API.
revoke execute on function public.reconcile_expired_jobs() from public, anon, authenticated;
revoke execute on function public.claim_job(uuid, integer) from public, anon, authenticated;
revoke execute on function public.complete_job(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_job(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.report_session_assets(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.begin_checkpoint(uuid, uuid, jsonb, uuid[], text) from public, anon, authenticated;
revoke execute on function public.record_checkpoint_file(uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.finalize_checkpoint(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.require_active_session(uuid) from public, anon, authenticated;
revoke execute on function public.user_can_edit(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.create_job(uuid, uuid, text, text, jsonb, boolean, integer) from public, anon;
revoke execute on function public.approve_pairing(text) from public, anon;
revoke execute on function public.create_project(text) from public, anon;
