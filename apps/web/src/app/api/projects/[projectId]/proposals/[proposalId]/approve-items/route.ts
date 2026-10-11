import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";

/**
 * Approves exactly the reviewed candidates of a theme update and finalizes each on its
 * document's branch. Ready candidates not listed are excluded; a document whose branch moved
 * fails on its own and can be retried.
 */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/proposals/[proposalId]/approve-items">,
  ) => {
    const { projectId, proposalId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const { items } = await parseJson(
      request,
      z.object({
        items: z
          .array(z.object({ itemId: z.uuid(), candidateCheckpointId: z.uuid() }))
          .min(1)
          .max(50),
      }),
    );
    const result = unwrap(
      await supabase.rpc("approve_proposal_items", { p_proposal_id: proposalId, p_items: items }),
    );
    return Response.json(result);
  },
);
