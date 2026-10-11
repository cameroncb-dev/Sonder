import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, unwrap } from "@/server/http";
import { requireAsset } from "@/server/projects";

/**
 * Removes a document from the project, with its card and connections. Only documents without
 * checkpoints can be removed, so no stored version is ever deleted this way.
 */
export const DELETE = handler(
  async (_request: Request, ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]">) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    await requireAsset(supabase, projectId, assetId);

    const { count } = await supabase
      .from("checkpoints")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", assetId);
    if (count)
      throw new HttpError(
        409,
        "HAS_HISTORY",
        "This document has checkpoints, so it can't be removed here",
      );

    unwrap(
      await supabase
        .from("canvas_items")
        .delete()
        .eq("project_id", projectId)
        .eq("item_type", "asset")
        .eq("ref_id", assetId),
    );
    unwrap(await supabase.from("assets").delete().eq("id", assetId).eq("project_id", projectId));
    return new Response(null, { status: 204 });
  },
);
