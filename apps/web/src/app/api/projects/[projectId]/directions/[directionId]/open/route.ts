import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { queueCheckout } from "@/server/checkout";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";
import { requireAsset } from "@/server/projects";

/**
 * Opens a direction's exact versions in their applications. Each document switches to a
 * branch at the saved version (reusing one that already points there, otherwise a new branch
 * named after the direction), so later captures continue from it without moving other
 * branches. Switching keeps its usual protection for unsaved or uncaptured work.
 */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/directions/[directionId]/open">,
  ) => {
    const { projectId, directionId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const { assetIds, force } = await parseJson(
      request,
      z.object({ assetIds: z.array(z.uuid()).optional(), force: z.boolean().default(false) }),
    );
    const direction = unwrap(
      await supabase
        .from("directions")
        .select("name,direction_entries(asset_id,checkpoint_id)")
        .eq("id", directionId)
        .eq("project_id", projectId)
        .maybeSingle(),
    ) as {
      name: string;
      direction_entries: Array<{ asset_id: string; checkpoint_id: string }>;
    } | null;
    if (!direction) throw new HttpError(404, "NOT_FOUND", "Direction not found");

    const opened = [];
    for (const entry of direction.direction_entries) {
      if (assetIds && !assetIds.includes(entry.asset_id)) continue;
      const asset = await requireAsset(supabase, projectId, entry.asset_id);
      const branches = unwrap(
        await supabase
          .from("branches")
          .select("id,name,head_checkpoint_id")
          .eq("asset_id", asset.id),
      ) as Array<{ id: string; name: string; head_checkpoint_id: string }>;
      // Prefer the active branch, then any branch already at the saved version.
      let branch =
        branches.find(
          (b) => b.id === asset.active_branch_id && b.head_checkpoint_id === entry.checkpoint_id,
        ) ?? branches.find((b) => b.head_checkpoint_id === entry.checkpoint_id);
      if (!branch) {
        const base = direction.name.slice(0, 90);
        let name = base;
        for (let i = 2; branches.some((b) => b.name === name); i++) name = `${base} ${i}`;
        branch = unwrap(
          await supabase
            .from("branches")
            .insert({
              asset_id: asset.id,
              name,
              head_checkpoint_id: entry.checkpoint_id,
              created_by: user.id,
            })
            .select("id,name,head_checkpoint_id")
            .single(),
        ) as { id: string; name: string; head_checkpoint_id: string };
      }
      const job = await queueCheckout(supabase, projectId, asset, branch, { force });
      opened.push({
        assetId: asset.id,
        assetName: asset.name,
        branchName: branch.name,
        jobId: job.id,
      });
    }
    return Response.json({ opened }, { status: 201 });
  },
);
