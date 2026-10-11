import { nativeIdentity } from "@sonder/connector-sdk";
import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";
import { loadThemeContext, planTheme, publicPlan, ThemeColors } from "@/server/themes";

type Ctx = RouteContext<"/api/projects/[projectId]/themes/[themeId]">;

/**
 * A theme with, per document, its mappable layers (and which theme color each takes) and a
 * plan saying whether the theme can be applied there and what would change.
 */
export const GET = handler(async (_request: Request, ctx: Ctx) => {
  const { projectId, themeId } = await ctx.params;
  const { user, supabase } = await requireUser();
  const role = await requireProjectRole(supabase, user.id, projectId, [
    "owner",
    "editor",
    "reviewer",
  ]);
  const c = await loadThemeContext(supabase, projectId, themeId);
  const plans = planTheme(c.theme, c.assets, c.roles, c.mappings, c.capabilities);

  return Response.json({
    role,
    theme: c.theme,
    assets: c.assets.map((asset) => {
      const identity = c.capabilities.get(asset.application)?.identityFields;
      const key = (n: Parameters<typeof nativeIdentity>[0]) => nativeIdentity(n, identity);
      return {
        id: asset.id,
        name: asset.name,
        branchName: asset.branchName,
        colorMode: asset.manifest?.document?.colorMode ?? null,
        elements: (asset.manifest?.elements ?? [])
          .filter((e) => e.kind === "text" || e.kind === "solid_fill")
          .map((e) => {
            const elementRole = c.roles.find(
              (r) => r.asset_id === asset.id && key(r.native_ref) === key(e.native),
            )?.role;
            const mapping = c.mappings.find(
              (m) => m.asset_id === asset.id && m.element_role === elementRole,
            );
            return {
              key: key(e.native),
              native: e.native,
              name: e.name,
              kind: e.kind,
              editable: e.editable,
              color: e.properties.find((p) => p.type === "text.color" || p.type === "fill.color")
                ?.value,
              colorRole: mapping?.color_role ?? null,
            };
          }),
      };
    }),
    plans: plans.map(publicPlan),
  });
});

/** Renames a theme or changes its colors. */
export const PATCH = handler(async (request: Request, ctx: Ctx) => {
  const { projectId, themeId } = await ctx.params;
  const { user, supabase } = await requireUser();
  await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
  const body = await parseJson(
    request,
    z.object({
      name: z.string().trim().min(1).max(100).optional(),
      colors: ThemeColors.optional(),
    }),
  );
  const theme = unwrap(
    await supabase
      .from("themes")
      .update(body)
      .eq("id", themeId)
      .eq("project_id", projectId)
      .select("id,name,colors,created_at")
      .maybeSingle(),
  );
  if (!theme) throw new HttpError(404, "NOT_FOUND", "Theme not found");
  return Response.json({ theme });
});

/** Deletes a theme, its mappings and its card. Applied results stay in each document's history. */
export const DELETE = handler(async (_request: Request, ctx: Ctx) => {
  const { projectId, themeId } = await ctx.params;
  const { user, supabase } = await requireUser();
  await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
  unwrap(
    await supabase
      .from("canvas_items")
      .delete()
      .eq("project_id", projectId)
      .eq("item_type", "theme")
      .eq("ref_id", themeId),
  );
  unwrap(await supabase.from("themes").delete().eq("id", themeId).eq("project_id", projectId));
  return new Response(null, { status: 204 });
});
