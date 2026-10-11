-- Every file path a document has used: the file it was linked from and each branch working
-- copy. Lets connectors recognise an older file of a tracked document (instead of linking it
-- again as a new document) and point the user at the file Sonder currently tracks.

alter table public.assets add column known_paths text[] not null default '{}';

update public.assets a
   set known_paths = (
     select coalesce(array_agg(distinct p), '{}')
       from (
         select a.native_locator ->> 'path' as p
         union
         select j.result ->> 'path' from public.jobs j
          where j.asset_id = a.id and j.operation = 'openCheckpoint' and j.status = 'succeeded'
       ) paths
      where p is not null
   );

create function public.remember_asset_path() returns trigger
language plpgsql set search_path = '' as $$
declare
  path text := new.native_locator ->> 'path';
begin
  if path is not null and not path = any (new.known_paths) then
    new.known_paths := new.known_paths || path;
  end if;
  return new;
end $$;

create trigger assets_remember_path before insert or update of native_locator on public.assets
  for each row execute function public.remember_asset_path();

create index assets_known_paths_idx on public.assets using gin (known_paths);

revoke execute on function public.remember_asset_path() from public, anon, authenticated;
