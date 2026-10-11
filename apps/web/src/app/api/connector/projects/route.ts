import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, unwrap } from "@/server/http";

/** Projects where the paired user can edit (the only ones a connector may act in). */
export const GET = handler(async (request: Request) => {
  const session = await requireConnectorSession(request);
  const rows = unwrap(
    await createAdminClient()
      .from("project_members")
      .select("role, projects(id,name)")
      .eq("user_id", session.userId)
      .in("role", ["owner", "editor"]),
  ) as unknown as Array<{ role: string; projects: { id: string; name: string } }>;
  return Response.json({ projects: rows.map((r) => ({ ...r.projects, role: r.role })) });
});
