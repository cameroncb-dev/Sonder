import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, unwrap } from "@/server/http";

interface Row {
  id: string;
  status: string;
  request: Record<string, unknown>;
  created_at: string;
  approved_at: string | null;
  proposal_items: Array<{
    id: string;
    asset_id: string;
    status: string;
    candidate_checkpoint_id: string | null;
    source_checkpoint_ids: string[];
    outcome: Record<string, unknown> | null;
  }>;
}

/** Applications of a theme, newest first, with each document's status and previews. */
export const GET = handler(
  async (
    _request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/themes/[themeId]/proposals">,
  ) => {
    const { projectId, themeId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor", "reviewer"]);
    const proposals = unwrap(
      await supabase
        .from("proposals")
        .select(
          "id,status,request,created_at,approved_at,proposal_items(id,asset_id,status,candidate_checkpoint_id,source_checkpoint_ids,outcome)",
        )
        .eq("project_id", projectId)
        .eq("kind", "coordinated_update")
        .eq("request->>themeId", themeId)
        .order("created_at", { ascending: false })
        .limit(10),
    ) as unknown as Row[];

    const ids = [
      ...new Set(
        proposals.flatMap((p) =>
          p.proposal_items.flatMap((i) => [i.candidate_checkpoint_id, ...i.source_checkpoint_ids]),
        ),
      ),
    ].filter((id): id is string => !!id);
    const checkpoints = ids.length
      ? (unwrap(
          await supabase.from("checkpoints").select("id,preview_path,preview_digest").in("id", ids),
        ) as Array<{ id: string; preview_path: string; preview_digest: string }>)
      : [];
    const { data: signed } = checkpoints.length
      ? await supabase.storage.from("previews").createSignedUrls(
          checkpoints.map((c) => c.preview_path),
          600,
        )
      : { data: [] };
    const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    const preview = (id: string | null | undefined) => {
      const c = checkpoints.find((x) => x.id === id);
      return c ? (urls.get(c.preview_path) ?? null) : null;
    };
    const { data: assets } = await supabase
      .from("assets")
      .select("id,name")
      .eq("project_id", projectId);

    return Response.json({
      proposals: proposals.map((p) => ({
        id: p.id,
        status: p.status,
        request: p.request,
        createdAt: p.created_at,
        approvedAt: p.approved_at,
        items: p.proposal_items.map((i) => ({
          id: i.id,
          assetId: i.asset_id,
          assetName: assets?.find((a) => a.id === i.asset_id)?.name ?? "Deleted document",
          status: i.status,
          outcome: i.outcome,
          candidateCheckpointId: i.candidate_checkpoint_id,
          candidatePreviewUrl: preview(i.candidate_checkpoint_id),
          beforePreviewUrl: preview(i.source_checkpoint_ids[0]),
        })),
      })),
    });
  },
);
