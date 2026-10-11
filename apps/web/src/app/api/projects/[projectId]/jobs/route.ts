import { OperationName } from "@sonder/contracts";
import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";

const CreateJob = z.object({
  operation: OperationName,
  assetId: z.uuid(),
  /** Client-generated idempotency key; retries with the same id return the same job. */
  operationId: z.string().min(8).max(200),
  params: z.record(z.string(), z.unknown()).default({}),
  requiresAssetSession: z.boolean().default(true),
  maxAttempts: z.number().int().min(1).max(10).default(3),
});

export const GET = handler(
  async (_request: Request, ctx: RouteContext<"/api/projects/[projectId]/jobs">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor", "reviewer"]);
    const jobs = unwrap(
      await supabase
        .from("jobs")
        .select(
          "id,asset_id,operation,operation_id,status,attempts,max_attempts,result,error,created_at,updated_at",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(100),
    );
    return Response.json({ jobs });
  },
);

export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/jobs">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const body = await parseJson(request, CreateJob);
    const job = unwrap(
      await supabase.rpc("create_job", {
        p_project_id: projectId,
        p_asset_id: body.assetId,
        p_operation: body.operation,
        p_operation_id: body.operationId,
        p_params: body.params,
        p_requires_asset_session: body.requiresAssetSession,
        p_max_attempts: body.maxAttempts,
      }),
    );
    return Response.json({ job }, { status: 201 });
  },
);
