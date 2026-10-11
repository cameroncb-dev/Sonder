import { HeartbeatRequest, type HeartbeatResponse } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, parseJson, unwrap } from "@/server/http";

/**
 * Reports open documents and their unsaved/uncaptured state; the backend maps them to assets the
 * paired user may edit and returns each asset's current branch head.
 */
export const POST = handler(async (request: Request) => {
  const session = await requireConnectorSession(request);
  const { openDocuments } = await parseJson(request, HeartbeatRequest);
  const rows = unwrap(
    await createAdminClient().rpc("report_session_documents", {
      p_session_id: session.id,
      p_documents: openDocuments.map(({ path, unsaved, uncaptured }) => ({
        path,
        unsaved,
        uncaptured,
      })),
    }),
  ) as Array<{
    asset_id: string;
    project_id: string;
    path: string;
    head_checkpoint_id: string | null;
  }>;
  const body: HeartbeatResponse = {
    sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    assets: rows.map((r) => ({
      assetId: r.asset_id,
      projectId: r.project_id,
      path: r.path,
      headCheckpointId: r.head_checkpoint_id,
    })),
  };
  return Response.json(body);
});
