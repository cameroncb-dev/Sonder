-- Phase 6 canvas additions: free text and sections. Both are presentation only, like notes;
-- they never reference application documents or version history. Sections use width/height.
alter table public.canvas_items drop constraint canvas_items_item_type_check;
alter table public.canvas_items add constraint canvas_items_item_type_check
  check (item_type in ('asset', 'reference', 'note', 'text', 'section', 'direction', 'theme'));
