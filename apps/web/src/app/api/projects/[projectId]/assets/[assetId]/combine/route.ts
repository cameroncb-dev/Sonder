import { defaultSide, rowId } from "@sonder/connector-sdk";
import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { computeCombination } from "@/server/combine";
import { handler, HttpError } from "@/server/http";
import { requireAsset } from "@/server/projects";

const Query = z.object({
  targetBranchId: z.uuid(),
  sourceBranchId: z.uuid(),
  baseCheckpointId: z.uuid().optional(),
});

const summary = (c: { id: string; message: string | null; created_at: string }) => ({
  id: c.id,
  message: c.message,
  createdAt: c.created_at,
});

/** Property-by-property comparison of two branches against their shared ancestor. */
export const GET = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/combine">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor", "reviewer"]);
    const asset = await requireAsset(supabase, projectId, assetId);
    const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success)
      throw new HttpError(
        400,
        "INVALID_PARAMETER",
        "targetBranchId and sourceBranchId are required",
      );

    const c = await computeCombination(supabase, asset, parsed.data);
    return Response.json({
      base: { ...summary(c.base.checkpoint), chosen: c.base.chosen },
      target: {
        branchId: c.target.branch.id,
        branchName: c.target.branch.name,
        checkpoint: summary(c.target.checkpoint),
      },
      source: {
        branchId: c.source.branch.id,
        branchName: c.source.branch.name,
        checkpoint: summary(c.source.checkpoint),
      },
      rows: c.merge.rows.map((row) => ({
        ...row,
        id: rowId(row),
        defaultSide: defaultSide(row) ?? null,
      })),
      structural: c.merge.structural,
    });
  },
);
