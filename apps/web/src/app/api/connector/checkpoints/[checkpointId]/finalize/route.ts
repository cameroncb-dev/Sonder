import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, unwrap } from "@/server/http";

/** Finalizes the checkpoint and completes its job atomically. Idempotent. */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/connector/checkpoints/[checkpointId]/finalize">,
  ) => {
    const { checkpointId } = await ctx.params;
    const session = await requireConnectorSession(request);
    const checkpoint = unwrap(
      await createAdminClient().rpc("finalize_checkpoint", {
        p_session_id: session.id,
        p_checkpoint_id: checkpointId,
      }),
    ) as { id: string; status: string };
    return Response.json({ checkpointId: checkpoint.id, status: checkpoint.status });
  },
);
