import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, unwrap } from "@/server/http";
import { loadThemeContext, planTheme } from "@/server/themes";

/** Rebuilds one failed document of a theme update from its current version. */
export const POST = handler(
  async (
    _request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/proposals/[proposalId]/items/[itemId]/retry">,
  ) => {
    const { projectId, proposalId, itemId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const proposal = unwrap(
      await supabase
        .from("proposals")
        .select("request,proposal_items(id,asset_id)")
        .eq("id", proposalId)
        .eq("project_id", projectId)
        .maybeSingle(),
    ) as {
      request: { themeId?: string };
      proposal_items: Array<{ id: string; asset_id: string }>;
    } | null;
    const item = proposal?.proposal_items.find((i) => i.id === itemId);
    if (!proposal?.request.themeId || !item)
      throw new HttpError(404, "NOT_FOUND", "Theme update item not found");

    const c = await loadThemeContext(supabase, projectId, proposal.request.themeId);
    const plan = planTheme(c.theme, c.assets, c.roles, c.mappings, c.capabilities).find(
      (p) => p.assetId === item.asset_id,
    );
    if (!plan || plan.status !== "ready")
      throw new HttpError(
        422,
        plan?.status === "no_changes" ? "NOTHING_TO_APPLY" : "UNSUPPORTED",
        plan?.reasons.join("; ") || "This document can't take the theme",
      );
    const retried = unwrap(
      await supabase.rpc("retry_proposal_item", {
        p_item_id: itemId,
        p_job_params: plan.jobParams,
      }),
    );
    return Response.json({ item: retried });
  },
);
