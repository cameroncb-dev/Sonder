import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";

/** Directions in the project. */
export const GET = handler(
  async (_request: Request, ctx: RouteContext<"/api/projects/[projectId]/directions">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor", "reviewer"]);
    const directions = unwrap(
      await supabase
        .from("directions")
        .select("id,name,description,created_at,direction_entries(asset_id,checkpoint_id)")
        .eq("project_id", projectId)
        .order("created_at"),
    );
    return Response.json({ directions });
  },
);

/** Saves a named set of exact document versions and places its card on the canvas. */
export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/directions">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const body = await parseJson(
      request,
      z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(1000).optional(),
        entries: z
          .array(z.object({ assetId: z.uuid(), checkpointId: z.uuid() }))
          .min(1)
          .max(50)
          .refine(
            (e) => new Set(e.map((x) => x.assetId)).size === e.length,
            "One version per document",
          ),
        x: z.number().default(0),
        y: z.number().default(0),
      }),
    );
    const direction = unwrap(
      await supabase.rpc("create_direction", {
        p_project_id: projectId,
        p_name: body.name,
        p_description: body.description ?? "",
        p_entries: body.entries,
      }),
    ) as { id: string };
    const item = unwrap(
      await supabase
        .from("canvas_items")
        .insert({
          project_id: projectId,
          item_type: "direction",
          ref_id: direction.id,
          x: body.x,
          y: body.y,
          updated_by: user.id,
        })
        .select("*")
        .single(),
    );
    return Response.json({ direction, item }, { status: 201 });
  },
);
