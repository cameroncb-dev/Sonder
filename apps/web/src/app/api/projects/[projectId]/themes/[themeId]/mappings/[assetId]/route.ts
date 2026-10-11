import { nativeIdentity } from "@sonder/connector-sdk";
import { NativeRef } from "@sonder/contracts";
import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";
import { requireAsset } from "@/server/projects";
import { COLOR_ROLES, loadThemeContext } from "@/server/themes";

const PROPERTY = { text: "text.color", solid_fill: "fill.color" } as const;

/** lower_snake_case role from a layer name, unique among the asset's roles. */
function roleName(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(?=[0-9])/, "layer_")
      .slice(0, 50) || "layer";
  let role = base;
  for (let i = 2; taken.has(role); i++) role = `${base}_${i}`;
  taken.add(role);
  return role;
}

/**
 * Sets which theme color each layer of one document takes. Layers get a named element role
 * (e.g. "headline") linked to the exact layer, reused by every theme.
 */
export const PUT = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/themes/[themeId]/mappings/[assetId]">,
  ) => {
    const { projectId, themeId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    await requireAsset(supabase, projectId, assetId);
    const body = await parseJson(
      request,
      z.object({
        elements: z
          .array(z.object({ native: NativeRef, colorRole: z.enum(COLOR_ROLES).nullable() }))
          .max(200),
      }),
    );

    const c = await loadThemeContext(supabase, projectId, themeId);
    const asset = c.assets.find((a) => a.id === assetId)!;
    const identity = c.capabilities.get(asset.application)?.identityFields;
    const key = (n: NativeRef) => nativeIdentity(n, identity);
    const elements = asset.manifest?.elements ?? [];
    const roles = c.roles.filter((r) => r.asset_id === assetId);
    const taken = new Set(roles.map((r) => r.role));

    const rows: Array<{ color_role: string; element_role: string; property: string }> = [];
    for (const choice of body.elements) {
      if (!choice.colorRole) continue;
      const element = elements.find((e) => key(e.native) === key(choice.native));
      if (!element || !(element.kind in PROPERTY))
        throw new HttpError(
          422,
          "INVALID_MAPPING",
          "Only text and fill layers in the latest version can be mapped",
        );
      let role = roles.find((r) => key(r.native_ref) === key(element.native))?.role;
      if (!role) {
        role = roleName(element.name, taken);
        unwrap(
          await supabase.from("asset_elements").insert({
            asset_id: assetId,
            role,
            kind: element.kind,
            native_ref: element.native,
          }),
        );
        roles.push({ asset_id: assetId, role, kind: element.kind, native_ref: element.native });
      }
      rows.push({
        color_role: choice.colorRole,
        element_role: role,
        property: PROPERTY[element.kind as keyof typeof PROPERTY],
      });
    }

    unwrap(
      await supabase
        .from("theme_mappings")
        .delete()
        .eq("theme_id", themeId)
        .eq("asset_id", assetId),
    );
    if (rows.length)
      unwrap(
        await supabase
          .from("theme_mappings")
          .insert(rows.map((r) => ({ ...r, theme_id: themeId, asset_id: assetId }))),
      );
    return Response.json({ mappings: rows });
  },
);
