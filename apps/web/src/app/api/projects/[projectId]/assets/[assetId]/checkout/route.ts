import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";
import { queueCheckout } from "@/server/checkout";
import { requireAsset } from "@/server/projects";

/**
 * Switches the asset to a branch by asking the connector to open that branch's
 * head as a working copy. The active branch changes only if the connector
 * succeeds, and it refuses when the open document has unsaved or uncaptured work.
 */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/checkout">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const asset = await requireAsset(supabase, projectId, assetId);
    const body = await parseJson(
      request,
      z.object({
        branchId: z.uuid(),
        force: z.boolean().default(false),
        operationId: z.string().min(8).max(200).optional(),
      }),
    );

    const branch = unwrap(
      await supabase
        .from("branches")
        .select("id,name,head_checkpoint_id")
        .eq("id", body.branchId)
        .eq("asset_id", assetId)
        .maybeSingle(),
    ) as { id: string; name: string; head_checkpoint_id: string } | null;
    if (!branch) throw new HttpError(404, "NOT_FOUND", "Branch not found for this asset");

    const job = await queueCheckout(supabase, projectId, asset, branch, body);
    return Response.json({ job }, { status: 201 });
  },
);
