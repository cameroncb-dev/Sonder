import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";

const CreateItem = z.discriminatedUnion("itemType", [
  z.object({
    itemType: z.literal("note"),
    x: z.number(),
    y: z.number(),
    content: z.object({ text: z.string().max(5000) }),
  }),
  z.object({
    itemType: z.literal("reference"),
    x: z.number(),
    y: z.number(),
    content: z.object({ path: z.string().min(1).max(500), name: z.string().max(300) }),
  }),
]);

export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/canvas/items">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const body = await parseJson(request, CreateItem);
    if (body.itemType === "reference" && !body.content.path.startsWith(`${projectId}/`)) {
      throw new HttpError(400, "INVALID_REQUEST", "Reference must be stored in this project");
    }
    const item = unwrap(
      await supabase
        .from("canvas_items")
        .insert({
          project_id: projectId,
          item_type: body.itemType,
          x: body.x,
          y: body.y,
          content: body.content,
          updated_by: user.id,
        })
        .select("*")
        .single(),
    );
    return Response.json({ item }, { status: 201 });
  },
);
