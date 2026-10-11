import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";

/**
 * Approves the exact candidate the reviewer saw and finalizes it on the target branch.
 * Fails if the candidate was replaced or the branch moved since.
 */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/proposals/[proposalId]/approve">,
  ) => {
    const { projectId, proposalId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const { candidateCheckpointId } = await parseJson(
      request,
      z.object({ candidateCheckpointId: z.uuid() }),
    );
    const proposal = unwrap(
      await supabase.rpc("approve_proposal", {
        p_proposal_id: proposalId,
        p_candidate_checkpoint_id: candidateCheckpointId,
      }),
    );
    return Response.json({ proposal });
  },
);
