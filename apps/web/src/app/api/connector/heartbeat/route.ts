import { HeartbeatRequest, type HeartbeatResponse } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, parseJson, unwrap } from "@/server/http";

/** Reports open documents; the backend maps them to assets the paired user may edit. */
export const POST = handler(async (request: Request) => {
  const session = await requireConnectorSession(request);
  const { openDocuments } = await parseJson(request, HeartbeatRequest);
  const rows = unwrap(
    await createAdminClient().rpc("report_session_assets", {
      p_session_id: session.id,
      p_paths: openDocuments.map((d) => d.path),
    }),
  ) as Array<{ asset_id: string; project_id: string; path: string }>;
  const body: HeartbeatResponse = {
    sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    assets: rows.map((r) => ({ assetId: r.asset_id, projectId: r.project_id, path: r.path })),
  };
  return Response.json(body);
});
