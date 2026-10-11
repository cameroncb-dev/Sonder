import { randomUUID } from "node:crypto";

import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";
import { requireAsset } from "@/server/projects";

interface Checkpoint {
  id: string;
  manifest: {
    files: { native: { name: string; bytes: number; digest: string } };
    elements: unknown[];
  };
}

/**
 * Switches the asset to a branch by asking the connector to open that branch's
 * head as a working copy. The active branch changes only if the connector
 * succeeds, and it refuses when the open document has unsaved or uncaptured work.
 */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/checkout">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const asset = await requireAsset(supabase, projectId, assetId);
    const body = await parseJson(
      request,
      z.object({
        branchId: z.uuid(),
        force: z.boolean().default(false),
        operationId: z.string().min(8).max(200).optional(),
      }),
    );

    const branch = unwrap(
      await supabase
        .from("branches")
        .select("id,name,head_checkpoint_id")
        .eq("id", body.branchId)
        .eq("asset_id", assetId)
        .maybeSingle(),
    ) as { id: string; name: string; head_checkpoint_id: string } | null;
    if (!branch) throw new HttpError(404, "NOT_FOUND", "Branch not found for this asset");

    const ids = [branch.head_checkpoint_id];
    const current = asset.active_branch_id
      ? (unwrap(
          await supabase
            .from("branches")
            .select("head_checkpoint_id")
            .eq("id", asset.active_branch_id)
            .single(),
        ) as {
          head_checkpoint_id: string;
        })
      : null;
    if (current) ids.push(current.head_checkpoint_id);
    const checkpoints = unwrap(
      await supabase.from("checkpoints").select("id,manifest").in("id", ids),
    ) as Checkpoint[];
    const target = checkpoints.find((c) => c.id === branch.head_checkpoint_id)!;
    const currentHead = current
      ? checkpoints.find((c) => c.id === current.head_checkpoint_id)
      : undefined;

    const job = unwrap(
      await supabase.rpc("create_job", {
        p_project_id: projectId,
        p_asset_id: assetId,
        p_operation: "openCheckpoint",
        p_operation_id: body.operationId ?? `checkout-${randomUUID()}`,
        p_params: {
          branchId: branch.id,
          branchName: branch.name,
          checkpointId: target.id,
          native: target.manifest.files.native,
          // Lets the connector detect work that was never captured before it closes the document.
          currentHeadElements: currentHead?.manifest.elements ?? null,
          force: body.force,
        },
        p_requires_asset_session: false,
      }),
    );
    return Response.json({ job }, { status: 201 });
  },
);
