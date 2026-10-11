import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";

export const GET = handler(
  async (_request: Request, ctx: RouteContext<"/api/projects/[projectId]/assets">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor", "reviewer"]);
    const assets = unwrap(
      await supabase
        .from("assets")
        .select("id,name,application,native_locator,created_at")
        .eq("project_id", projectId),
    );
    return Response.json({ assets });
  },
);

export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/assets">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const body = await parseJson(
      request,
      z.object({
        name: z.string().trim().min(1).max(300),
        application: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
        nativeLocator: z.record(z.string(), z.unknown()).default({}),
      }),
    );
    const asset = unwrap(
      await supabase
        .from("assets")
        .insert({
          project_id: projectId,
          name: body.name,
          application: body.application,
          native_locator: body.nativeLocator,
          created_by: user.id,
        })
        .select("id,name,application,native_locator")
        .single(),
    );
    return Response.json({ asset }, { status: 201 });
  },
);
