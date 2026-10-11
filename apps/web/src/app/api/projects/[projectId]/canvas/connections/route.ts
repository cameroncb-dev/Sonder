import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";

/** Visual links between cards. They are stored apart from checkpoint ancestry and never change it. */
export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/canvas/connections">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const body = await parseJson(
      request,
      z.object({ fromItemId: z.uuid(), toItemId: z.uuid(), label: z.string().max(100).optional() }),
    );
    const connection = unwrap(
      await supabase
        .from("canvas_connections")
        .insert({
          project_id: projectId,
          from_item_id: body.fromItemId,
          to_item_id: body.toItemId,
          label: body.label ?? null,
        })
        .select("id,from_item_id,to_item_id,label")
        .single(),
    );
    return Response.json({ connection }, { status: 201 });
  },
);
