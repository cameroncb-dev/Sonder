import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";

/** Keeps a tried suggestion's exact candidate as a new branch. */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/proposals/[proposalId]/keep">,
  ) => {
    const { projectId, proposalId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const { candidateCheckpointId, branchName } = await parseJson(
      request,
      z.object({ candidateCheckpointId: z.uuid(), branchName: z.string().trim().min(1).max(100) }),
    );
    const kept = unwrap(
      await supabase.rpc("keep_suggestion", {
        p_proposal_id: proposalId,
        p_candidate_checkpoint_id: candidateCheckpointId,
        p_branch_name: branchName,
      }),
    );
    return Response.json(kept);
  },
);
