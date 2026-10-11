import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, unwrap } from "@/server/http";

/** Discards a proposal. Its candidate stays stored but never enters history. */
export const POST = handler(
  async (
    _request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/proposals/[proposalId]/reject">,
  ) => {
    const { projectId, proposalId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const proposal = unwrap(await supabase.rpc("reject_proposal", { p_proposal_id: proposalId }));
    return Response.json({ proposal });
  },
);
