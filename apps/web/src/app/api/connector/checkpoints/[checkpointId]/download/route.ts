import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, HttpError, unwrap } from "@/server/http";

/** Native snapshot bytes for a finalized checkpoint in a project the paired user can edit. */
export const GET = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/connector/checkpoints/[checkpointId]/download">,
  ) => {
    const { checkpointId } = await ctx.params;
    const session = await requireConnectorSession(request);
    const admin = createAdminClient();
    const checkpoint = unwrap(
      await admin
        .from("checkpoints")
        .select("project_id,status,native_path,manifest")
        .eq("id", checkpointId)
        .maybeSingle(),
    ) as {
      project_id: string;
      status: string;
      native_path: string;
      manifest: { files: { native: { mediaType: string } } };
    } | null;
    if (!checkpoint || checkpoint.status !== "finalized")
      throw new HttpError(404, "NOT_FOUND", "Checkpoint not found");
    const canEdit = unwrap(
      await admin.rpc("user_can_edit", {
        p_user_id: session.userId,
        p_project_id: checkpoint.project_id,
      }),
    );
    if (!canEdit) throw new HttpError(404, "NOT_FOUND", "Checkpoint not found");

    const { data, error } = await admin.storage.from("snapshots").download(checkpoint.native_path);
    if (error || !data) throw new HttpError(502, "STORAGE_ERROR", "Snapshot download failed");
    return new Response(data, {
      headers: { "content-type": checkpoint.manifest.files.native.mediaType },
    });
  },
);
