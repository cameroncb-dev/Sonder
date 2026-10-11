import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, unwrap } from "@/server/http";

/** Recoverable (finalized) checkpoints only, with short-lived signed preview URLs. */
export const GET = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/checkpoints">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor", "reviewer"]);
    const assetId = new URL(request.url).searchParams.get("assetId");
    let query = supabase
      .from("checkpoints")
      .select(
        "id,asset_id,status,operation_id,message,native_path,native_bytes,preview_path,created_by,created_at,finalized_at",
      )
      .eq("project_id", projectId)
      .eq("status", "finalized")
      .order("created_at", { ascending: false });
    if (assetId) query = query.eq("asset_id", assetId);
    const checkpoints = unwrap(await query);

    const previews = checkpoints.map((c) => c.preview_path as string);
    const { data: signed, error } = previews.length
      ? await supabase.storage.from("previews").createSignedUrls(previews, 300)
      : { data: [], error: null };
    if (error) throw new HttpError(502, "STORAGE_ERROR", "Could not sign preview URLs");
    return Response.json({
      checkpoints: checkpoints.map((c, i) => ({
        ...c,
        previewUrl: signed?.[i]?.signedUrl ?? null,
      })),
    });
  },
);
