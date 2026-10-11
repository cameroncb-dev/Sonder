import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/server";
import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";

export const GET = handler(
  async (_request: Request, ctx: RouteContext<"/api/projects/[projectId]/members">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor", "reviewer"]);
    const members = unwrap(
      await supabase
        .from("project_members")
        .select("user_id,role,created_at")
        .eq("project_id", projectId),
    );
    return Response.json({ members });
  },
);

/** Owners add or change members by email. The user must already have an account. */
export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/members">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner"]);
    const body = await parseJson(
      request,
      z.object({ email: z.email(), role: z.enum(["owner", "editor", "reviewer"]) }),
    );

    // Look up the account server-side; the browser never sees other users' ids by email.
    const admin = createAdminClient();
    let memberId: string | undefined;
    for (let page = 1; page <= 20 && !memberId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new HttpError(500, "INTERNAL", "User lookup failed");
      memberId = data.users.find((u) => u.email?.toLowerCase() === body.email.toLowerCase())?.id;
      if (data.users.length < 200) break;
    }
    if (!memberId) throw new HttpError(404, "NOT_FOUND", "No account with that email");

    const member = unwrap(
      await supabase
        .from("project_members")
        .upsert({ project_id: projectId, user_id: memberId, role: body.role })
        .select("user_id,role")
        .single(),
    );
    return Response.json({ member }, { status: 201 });
  },
);
