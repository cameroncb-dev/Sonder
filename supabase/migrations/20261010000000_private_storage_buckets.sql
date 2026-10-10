-- Phase 1: private buckets for user artifacts.
--
-- Object paths must start with the uploader's user id: "<auth.uid()>/...".
-- Phase 3 replaces these owner-only policies with project-membership policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Native application snapshots (PSD today; other connectors later).
  ('snapshots', 'snapshots', false, 52428800, null),
  ('previews', 'previews', false, 20971520, array['image/png', 'image/jpeg', 'image/webp']),
  ('references', 'references', false, 20971520, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners read their artifacts"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('snapshots', 'previews', 'references')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Owners upload their artifacts"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('snapshots', 'previews', 'references')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Owners delete their artifacts"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('snapshots', 'previews', 'references')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No update policy: stored artifacts are write-once. Checkpoint immutability
-- is enforced in the data model in Phase 3.
