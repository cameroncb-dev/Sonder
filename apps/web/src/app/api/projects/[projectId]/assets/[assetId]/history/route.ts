import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, unwrap } from "@/server/http";
import { requireAsset } from "@/server/projects";

interface CheckpointRow {
  id: string;
  message: string | null;
  created_at: string;
  created_by: string | null;
  preview_path: string;
  native_bytes: number;
  proposal_item_id: string | null;
  manifest: { elements?: unknown[]; document?: unknown; applicationVersion?: string };
}

/** Finalized checkpoints with parent links, branches and pending jobs for one asset. */
export const GET = handler(
  async (
    _request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/history">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    const role = await requireProjectRole(supabase, user.id, projectId, [
      "owner",
      "editor",
      "reviewer",
    ]);
    const asset = await requireAsset(supabase, projectId, assetId);

    const all = unwrap(
      await supabase
        .from("checkpoints")
        .select(
          "id,message,created_at,created_by,preview_path,native_bytes,proposal_item_id,manifest",
        )
        .eq("asset_id", assetId)
        .eq("status", "finalized")
        .order("created_at"),
    ) as CheckpointRow[];
    // Combination candidates join history only once their proposal is approved.
    const itemIds = all.map((c) => c.proposal_item_id).filter((id): id is string => !!id);
    const finalizedItems = new Set(
      itemIds.length
        ? (
            unwrap(
              await supabase
                .from("proposal_items")
                .select("id")
                .in("id", itemIds)
                .eq("status", "finalized"),
            ) as Array<{ id: string }>
          ).map((i) => i.id)
        : [],
    );
    const checkpoints = all.filter(
      (c) => !c.proposal_item_id || finalizedItems.has(c.proposal_item_id),
    );
    const parents = unwrap(
      await supabase
        .from("checkpoint_parents")
        .select("checkpoint_id,parent_id")
        .eq("asset_id", assetId),
    ) as Array<{
      checkpoint_id: string;
      parent_id: string;
    }>;
    const branches = unwrap(
      await supabase
        .from("branches")
        .select("id,name,head_checkpoint_id,created_at,updated_at")
        .eq("asset_id", assetId)
        .order("created_at"),
    );
    const jobs = unwrap(
      await supabase
        .from("jobs")
        .select("id,operation,status,attempts,params,error,result,created_at,updated_at")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false })
        .limit(10),
    );

    const paths = checkpoints.map((c) => c.preview_path);
    const { data: signed } = paths.length
      ? await supabase.storage.from("previews").createSignedUrls(paths, 600)
      : { data: [] };
    const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

    return Response.json({
      role,
      asset: {
        id: asset.id,
        name: asset.name,
        application: asset.application,
        path: asset.native_locator.path ?? null,
        activeBranchId: asset.active_branch_id,
      },
      branches,
      checkpoints: checkpoints.map((c) => ({
        id: c.id,
        message: c.message,
        createdAt: c.created_at,
        createdBy: c.created_by,
        parents: parents.filter((p) => p.checkpoint_id === c.id).map((p) => p.parent_id),
        previewUrl: urls.get(c.preview_path) ?? null,
        nativeBytes: c.native_bytes,
        document: c.manifest.document ?? null,
        elements: c.manifest.elements ?? [],
      })),
      jobs,
    });
  },
);
