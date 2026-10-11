-- Explicit function grants. Hosted projects grant EXECUTE to these roles only
-- through PUBLIC, so revoking PUBLIC in the previous migration also removed
-- access for signed-in users and the backend. Grant exactly what each needs.

-- Signed-in users (each function checks auth.uid() and project roles itself).
grant execute on function public.create_project(text) to authenticated;
grant execute on function public.create_job(uuid, uuid, text, text, jsonb, boolean, integer) to authenticated;
grant execute on function public.approve_pairing(text) to authenticated;

-- Backend only (service role). Not exposed to anon or authenticated clients.
grant execute on function public.reconcile_expired_jobs() to service_role;
grant execute on function public.claim_job(uuid, integer) to service_role;
grant execute on function public.complete_job(uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_job(uuid, uuid, jsonb, boolean) to service_role;
grant execute on function public.report_session_assets(uuid, text[]) to service_role;
grant execute on function public.begin_checkpoint(uuid, uuid, jsonb, uuid[], text) to service_role;
grant execute on function public.record_checkpoint_file(uuid, uuid, text, text, bigint, text) to service_role;
grant execute on function public.finalize_checkpoint(uuid, uuid) to service_role;
grant execute on function public.require_active_session(uuid) to service_role;
grant execute on function public.user_can_edit(uuid, uuid) to service_role;
