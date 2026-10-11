import { randomUUID } from "node:crypto";

import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";
import { requireAsset } from "@/server/projects";

/** Queues a capture of the asset's open document onto its active branch. */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/capture">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const asset = await requireAsset(supabase, projectId, assetId);
    const body = await parseJson(
      request,
      z.object({
        message: z.string().trim().max(500).optional(),
        operationId: z.string().min(8).max(200).optional(),
      }),
    );
    const job = unwrap(
      await supabase.rpc("create_job", {
        p_project_id: projectId,
        p_asset_id: assetId,
        p_operation: "captureCheckpoint",
        p_operation_id: body.operationId ?? `capture-${randomUUID()}`,
        p_params: {
          ...(body.message ? { message: body.message } : {}),
          ...(asset.active_branch_id ? { branchId: asset.active_branch_id } : {}),
        },
        p_requires_asset_session: true,
      }),
    );
    return Response.json({ job }, { status: 201 });
  },
);
