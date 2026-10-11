import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";
import { ThemeColors } from "@/server/themes";

/** Themes in the project. */
export const GET = handler(
  async (_request: Request, ctx: RouteContext<"/api/projects/[projectId]/themes">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor", "reviewer"]);
    const themes = unwrap(
      await supabase
        .from("themes")
        .select("id,name,colors,created_at")
        .eq("project_id", projectId)
        .order("created_at"),
    );
    return Response.json({ themes });
  },
);

/** Creates a theme and its card on the canvas. */
export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/themes">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const body = await parseJson(
      request,
      z.object({
        name: z.string().trim().min(1).max(100),
        colors: ThemeColors,
        x: z.number().default(0),
        y: z.number().default(0),
      }),
    );
    const theme = unwrap(
      await supabase
        .from("themes")
        .insert({
          project_id: projectId,
          name: body.name,
          colors: body.colors,
          created_by: user.id,
        })
        .select("id,name,colors,created_at")
        .single(),
    ) as { id: string };
    const item = unwrap(
      await supabase
        .from("canvas_items")
        .insert({
          project_id: projectId,
          item_type: "theme",
          ref_id: theme.id,
          x: body.x,
          y: body.y,
          updated_by: user.id,
        })
        .select("*")
        .single(),
    );
    return Response.json({ theme, item }, { status: 201 });
  },
);
