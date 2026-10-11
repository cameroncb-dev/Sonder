-- Linking the same document twice (double clicks, retries) must resolve to one asset, and
-- concurrent canvas loads must place one card per asset. Both were check-then-insert races.

create unique index assets_project_app_path_key
  on public.assets (project_id, application, (native_locator ->> 'path'))
  where native_locator ? 'path';

-- Not partial, so PostgREST upserts can target it. ref_id is a UUID or null (nulls are distinct).
create unique index canvas_items_project_ref_key on public.canvas_items (project_id, ref_id);
