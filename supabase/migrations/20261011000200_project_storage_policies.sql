-- Phase 3: storage access follows project membership.
--
-- Object paths start with the project id: "<project_id>/<asset_id>/<checkpoint_id>/<file>"
-- for snapshots and previews, "<project_id>/<file>" for references.
-- Snapshots and previews are written only by the backend (service role) after
-- it verifies size and digest against the checkpoint manifest.

drop policy if exists "Owners read their artifacts" on storage.objects;
drop policy if exists "Owners upload their artifacts" on storage.objects;
drop policy if exists "Owners delete their artifacts" on storage.objects;

-- Returns null instead of raising for paths whose first segment is not a uuid.
create function public.storage_project_id(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when invalid_text_representation then
  return null;
end $$;

create policy "Members read project artifacts"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('snapshots', 'previews', 'references')
    and public.is_project_member(public.storage_project_id(name))
  );

create policy "Editors upload references"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'references'
    and public.can_edit_project(public.storage_project_id(name))
  );

-- No update or delete policies: stored artifacts are write-once for clients.
