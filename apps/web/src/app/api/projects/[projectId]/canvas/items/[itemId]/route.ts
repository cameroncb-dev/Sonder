import { z } from "zod";

import { NoteContent, SectionContent, TextContent } from "@/lib/canvas-style";
import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";

const UpdateItem = z
  .object({
    /** The version the client last saw. The save fails with 409 if the item changed since. */
    version: z.number().int().positive(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().nullable().optional(),
    height: z.number().positive().nullable().optional(),
    content: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

type Ctx = RouteContext<"/api/projects/[projectId]/canvas/items/[itemId]">;

/** Content shapes for editable card types; other types keep their content as created. */
const CONTENT: Record<string, z.ZodType> = {
  note: NoteContent,
  text: TextContent,
  section: SectionContent,
};

export const PATCH = handler(async (request: Request, ctx: Ctx) => {
  const { projectId, itemId } = await ctx.params;
  const { user, supabase } = await requireUser();
  await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
  const { version, ...changes } = await parseJson(request, UpdateItem);
  if (changes.content) {
    const existing = unwrap(
      await supabase
        .from("canvas_items")
        .select("item_type")
        .eq("id", itemId)
        .eq("project_id", projectId)
        .maybeSingle(),
    ) as { item_type: string } | null;
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Canvas item not found");
    const schema = CONTENT[existing.item_type];
    if (!schema)
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        `A ${existing.item_type} card's content can't be edited`,
      );
    const parsed = schema.safeParse(changes.content);
    if (!parsed.success)
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        parsed.error.issues[0]?.message ?? "Invalid content",
      );
    changes.content = parsed.data as Record<string, unknown>;
  }

  const updated = unwrap(
    await supabase
      .from("canvas_items")
      .update({ ...changes, version: version + 1, updated_by: user.id })
      .eq("id", itemId)
      .eq("project_id", projectId)
      .eq("version", version)
      .select("*"),
  ) as Array<Record<string, unknown>>;
  if (updated.length === 1) return Response.json({ item: updated[0] });

  const current = unwrap(
    await supabase
      .from("canvas_items")
      .select("*")
      .eq("id", itemId)
      .eq("project_id", projectId)
      .maybeSingle(),
  );
  if (!current) throw new HttpError(404, "NOT_FOUND", "Canvas item not found");
  throw new HttpError(409, "VERSION_CONFLICT", "This card changed since you loaded it", {
    current,
  });
});

export const DELETE = handler(async (_request: Request, ctx: Ctx) => {
  const { projectId, itemId } = await ctx.params;
  const { user, supabase } = await requireUser();
  await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
  const deleted = unwrap(
    await supabase
      .from("canvas_items")
      .delete()
      .eq("id", itemId)
      .eq("project_id", projectId)
      .neq("item_type", "asset")
      .select("id"),
  ) as unknown[];
  if (!deleted.length)
    throw new HttpError(
      404,
      "NOT_FOUND",
      "Card not found (documents are deleted from their inspector)",
    );
  return new Response(null, { status: 204 });
});
