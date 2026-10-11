import type { CheckpointElementsResponse, Element } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, HttpError, unwrap } from "@/server/http";

/** Elements of a finalized checkpoint, so a connector can tell whether an open document changed. */
export const GET = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/connector/checkpoints/[checkpointId]/elements">,
  ) => {
    const { checkpointId } = await ctx.params;
    const session = await requireConnectorSession(request);
    const admin = createAdminClient();
    const checkpoint = unwrap(
      await admin
        .from("checkpoints")
        .select("project_id,status,manifest")
        .eq("id", checkpointId)
        .maybeSingle(),
    ) as { project_id: string; status: string; manifest: { elements?: Element[] } } | null;
    if (!checkpoint || checkpoint.status !== "finalized")
      throw new HttpError(404, "NOT_FOUND", "Checkpoint not found");
    const canEdit = unwrap(
      await admin.rpc("user_can_edit", {
        p_user_id: session.userId,
        p_project_id: checkpoint.project_id,
      }),
    );
    if (!canEdit) throw new HttpError(404, "NOT_FOUND", "Checkpoint not found");
    const body: CheckpointElementsResponse = {
      checkpointId,
      elements: checkpoint.manifest.elements ?? [],
    };
    return Response.json(body);
  },
);
