import { JobCompleteRequest } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, parseJson, unwrap } from "@/server/http";

export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/connector/jobs/[jobId]/complete">) => {
    const { jobId } = await ctx.params;
    const session = await requireConnectorSession(request);
    const { result } = await parseJson(request, JobCompleteRequest);
    const job = unwrap(
      await createAdminClient().rpc("complete_job", {
        p_session_id: session.id,
        p_job_id: jobId,
        p_result: result,
      }),
    ) as { status: string };
    return Response.json({ status: job.status });
  },
);
