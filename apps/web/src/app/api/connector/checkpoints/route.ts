import { CheckpointBeginRequest, type CheckpointBeginResponse } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, parseJson, unwrap } from "@/server/http";

/** Starts (or, on repeated delivery, resumes) the checkpoint for a leased job. */
export const POST = handler(async (request: Request) => {
  const session = await requireConnectorSession(request);
  const body = await parseJson(request, CheckpointBeginRequest);
  const checkpoint = unwrap(
    await createAdminClient().rpc("begin_checkpoint", {
      p_session_id: session.id,
      p_job_id: body.jobId,
      p_manifest: body.manifest,
      p_parent_ids: body.parentIds,
      p_message: body.message ?? null,
    }),
  ) as {
    id: string;
    status: "pending" | "finalized";
    native_path: string | null;
    preview_path: string | null;
  };
  const response: CheckpointBeginResponse = {
    checkpointId: checkpoint.id,
    status: checkpoint.status,
    storedFiles: [
      ...(checkpoint.native_path ? (["native"] as const) : []),
      ...(checkpoint.preview_path ? (["preview"] as const) : []),
    ],
  };
  return Response.json(response);
});
