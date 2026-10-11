import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";
import { loadThemeContext, planTheme, publicPlan } from "@/server/themes";

/**
 * Applies a theme to the chosen documents: each one that can take it gets its own candidate
 * built by its connector; documents that can't are recorded as excluded with the reason.
 */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/themes/[themeId]/apply">,
  ) => {
    const { projectId, themeId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const { assetIds } = await parseJson(
      request,
      z.object({ assetIds: z.array(z.uuid()).min(1).max(50) }),
    );

    const c = await loadThemeContext(supabase, projectId, themeId);
    const plans = planTheme(c.theme, c.assets, c.roles, c.mappings, c.capabilities);
    const chosen = plans.filter((p) => assetIds.includes(p.assetId));
    if (!chosen.some((p) => p.status === "ready"))
      throw new HttpError(
        422,
        "NOTHING_TO_APPLY",
        "None of the chosen documents can take this theme right now",
        { plans: chosen },
      );
    // Mapped documents that weren't chosen are recorded as excluded, so the result is complete.
    const items = plans
      .filter((p) => assetIds.includes(p.assetId) || p.status !== "no_mappings")
      .map((p) =>
        assetIds.includes(p.assetId) && p.status === "ready"
          ? { assetId: p.assetId, include: true, jobParams: p.jobParams }
          : {
              assetId: p.assetId,
              include: false,
              reason: assetIds.includes(p.assetId) ? p.reasons.join("; ") : "Not chosen",
            },
      );

    const created = unwrap(
      await supabase.rpc("create_coordinated_proposal", {
        p_project_id: projectId,
        p_request: {
          themeId,
          themeName: c.theme.name,
          colors: c.theme.colors,
          plans: chosen.map(publicPlan),
        },
        p_items: items,
      }),
    );
    return Response.json(created, { status: 201 });
  },
);
