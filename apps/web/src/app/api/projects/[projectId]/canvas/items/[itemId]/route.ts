import { z } from "zod";

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

export const PATCH = handler(async (request: Request, ctx: Ctx) => {
  const { projectId, itemId } = await ctx.params;
  const { user, supabase } = await requireUser();
  await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
  const { version, ...changes } = await parseJson(request, UpdateItem);

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
      "Note or reference not found (asset cards cannot be deleted)",
    );
  return new Response(null, { status: 204 });
});
