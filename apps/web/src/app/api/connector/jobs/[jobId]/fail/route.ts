import { JobFailRequest } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, parseJson, unwrap } from "@/server/http";

export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/connector/jobs/[jobId]/fail">) => {
    const { jobId } = await ctx.params;
    const session = await requireConnectorSession(request);
    const { error, retryable } = await parseJson(request, JobFailRequest);
    const job = unwrap(
      await createAdminClient().rpc("fail_job", {
        p_session_id: session.id,
        p_job_id: jobId,
        p_error: error,
        p_retryable: retryable,
      }),
    ) as { status: string; attempts: number; max_attempts: number };
    return Response.json({
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
    });
  },
);
