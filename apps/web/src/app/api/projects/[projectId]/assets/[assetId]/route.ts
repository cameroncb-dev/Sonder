import { createAdminClient } from "@/lib/supabase/server";
import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, unwrap } from "@/server/http";
import { requireAsset } from "@/server/projects";

/**
 * Removes a document from the project with its card, connections, branches, checkpoints,
 * proposals and stored files. A document with checkpoints is deleted only when the caller
 * passes `?withHistory=true`, which the canvas sends after the user confirms.
 */
export const DELETE = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]">) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    await requireAsset(supabase, projectId, assetId);

    const checkpoints = unwrap(
      await supabase.from("checkpoints").select("native_path,preview_path").eq("asset_id", assetId),
    ) as Array<{ native_path: string | null; preview_path: string | null }>;
    if (checkpoints.length && new URL(request.url).searchParams.get("withHistory") !== "true")
      throw new HttpError(
        409,
        "HAS_HISTORY",
        `This document has ${checkpoints.length} checkpoints; confirm to delete them too`,
      );

    unwrap(
      await supabase
        .from("canvas_items")
        .delete()
        .eq("project_id", projectId)
        .eq("item_type", "asset")
        .eq("ref_id", assetId),
    );
    // Cascades to branches, checkpoints, parents, jobs, proposals and session links.
    unwrap(await supabase.from("assets").delete().eq("id", assetId).eq("project_id", projectId));

    // Stored files are written only by the backend, so the backend removes them. A failure
    // here leaves unreachable files behind but never undoes the deletion.
    const admin = createAdminClient();
    const remove = async (bucket: string, paths: Array<string | null>) => {
      const list = paths.filter((p): p is string => !!p);
      for (let i = 0; i < list.length; i += 100)
        await admin.storage.from(bucket).remove(list.slice(i, i + 100));
    };
    await remove(
      "snapshots",
      checkpoints.map((c) => c.native_path),
    );
    await remove(
      "previews",
      checkpoints.map((c) => c.preview_path),
    );
    return new Response(null, { status: 204 });
  },
);
