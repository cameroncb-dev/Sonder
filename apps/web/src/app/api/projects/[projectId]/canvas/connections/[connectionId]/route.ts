import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, unwrap } from "@/server/http";

export const DELETE = handler(
  async (
    _request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/canvas/connections/[connectionId]">,
  ) => {
    const { projectId, connectionId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    unwrap(
      await supabase
        .from("canvas_connections")
        .delete()
        .eq("id", connectionId)
        .eq("project_id", projectId),
    );
    return new Response(null, { status: 204 });
  },
);
