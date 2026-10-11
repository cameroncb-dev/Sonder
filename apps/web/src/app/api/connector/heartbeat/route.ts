import { HeartbeatRequest, type HeartbeatResponse } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, parseJson, unwrap } from "@/server/http";

interface AssetInfo {
  id: string;
  project_id: string;
  name: string;
  native_locator: { path?: string };
  known_paths: string[];
  branches: { name: string } | null;
}

const ASSET_INFO =
  "id,project_id,name,native_locator,known_paths,branches!assets_active_branch_fk(name)";

/**
 * Reports open documents and their unsaved/uncaptured state; the backend maps them to assets the
 * paired user may edit and returns each asset's current branch head and names. Open files that
 * a tracked document used before are returned as `formerDocuments`.
 */
export const POST = handler(async (request: Request) => {
  const session = await requireConnectorSession(request);
  const { openDocuments } = await parseJson(request, HeartbeatRequest);
  const admin = createAdminClient();
  const rows = unwrap(
    await admin.rpc("report_session_documents", {
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

  const tracked = new Set(rows.map((r) => r.path));
  const untracked = openDocuments.map((d) => d.path).filter((p) => !tracked.has(p));
  const info = rows.length
    ? (unwrap(
        await admin
          .from("assets")
          .select(ASSET_INFO)
          .in(
            "id",
            rows.map((r) => r.asset_id),
          ),
      ) as unknown as AssetInfo[])
    : [];
  const candidates = untracked.length
    ? (unwrap(
        await admin
          .from("assets")
          .select(ASSET_INFO)
          .eq("application", session.application)
          .overlaps("known_paths", untracked),
      ) as unknown as AssetInfo[])
    : [];

  // Former files are reported only for documents the paired user may edit, as tracked ones are.
  const editable = new Set<string>();
  for (const projectId of new Set(candidates.map((a) => a.project_id))) {
    const ok = unwrap(
      await admin.rpc("user_can_edit", { p_user_id: session.userId, p_project_id: projectId }),
    );
    if (ok) editable.add(projectId);
  }

  const body: HeartbeatResponse = {
    sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    assets: rows.map((r) => {
      const a = info.find((x) => x.id === r.asset_id);
      return {
        assetId: r.asset_id,
        projectId: r.project_id,
        path: r.path,
        headCheckpointId: r.head_checkpoint_id,
        ...(a ? { assetName: a.name, branchName: a.branches?.name ?? null } : {}),
      };
    }),
    formerDocuments: untracked.flatMap((path) =>
      candidates
        .filter((a) => editable.has(a.project_id) && a.known_paths.includes(path))
        .map((a) => ({
          path,
          assetId: a.id,
          projectId: a.project_id,
          assetName: a.name,
          currentPath: a.native_locator.path ?? null,
          branchName: a.branches?.name ?? null,
        })),
    ),
  };
  return Response.json(body);
});
