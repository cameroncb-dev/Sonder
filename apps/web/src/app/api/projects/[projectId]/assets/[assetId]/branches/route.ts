import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";
import { requireAsset } from "@/server/projects";

/** Creates a branch pointing at an existing checkpoint. The checkpoint itself never changes. */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/branches">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    await requireAsset(supabase, projectId, assetId);
    const body = await parseJson(
      request,
      z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^[\w .-]+$/, "Use letters, numbers, spaces, . _ -"),
        checkpointId: z.uuid(),
      }),
    );
    const branch = unwrap(
      await supabase
        .from("branches")
        .insert({
          asset_id: assetId,
          name: body.name,
          head_checkpoint_id: body.checkpointId,
          created_by: user.id,
        })
        .select("id,name,head_checkpoint_id")
        .single(),
    );
    return Response.json({ branch }, { status: 201 });
  },
);
