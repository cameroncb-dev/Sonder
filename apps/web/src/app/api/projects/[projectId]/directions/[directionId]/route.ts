import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, unwrap } from "@/server/http";

type Ctx = RouteContext<"/api/projects/[projectId]/directions/[directionId]">;

interface Row {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  direction_entries: Array<{ asset_id: string; checkpoint_id: string }>;
}

/** A direction's exact versions, with previews and whether each document has moved on since. */
export const GET = handler(async (_request: Request, ctx: Ctx) => {
  const { projectId, directionId } = await ctx.params;
  const { user, supabase } = await requireUser();
  const role = await requireProjectRole(supabase, user.id, projectId, [
    "owner",
    "editor",
    "reviewer",
  ]);
  const direction = unwrap(
    await supabase
      .from("directions")
      .select("id,name,description,created_at,direction_entries(asset_id,checkpoint_id)")
      .eq("id", directionId)
      .eq("project_id", projectId)
      .maybeSingle(),
  ) as Row | null;
  if (!direction) throw new HttpError(404, "NOT_FOUND", "Direction not found");

  const entries = direction.direction_entries;
  const checkpointIds = entries.map((e) => e.checkpoint_id);
  const assetIds = entries.map((e) => e.asset_id);
  const [checkpoints, assets] = await Promise.all([
    checkpointIds.length
      ? supabase
          .from("checkpoints")
          .select("id,message,created_at,preview_path")
          .in("id", checkpointIds)
      : Promise.resolve({ data: [], error: null }),
    assetIds.length
      ? supabase
          .from("assets")
          .select(
            "id,name,active_branch_id,branches!assets_active_branch_fk(name,head_checkpoint_id)",
          )
          .in("id", assetIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const cps = unwrap(checkpoints) as Array<{
    id: string;
    message: string | null;
    created_at: string;
    preview_path: string;
  }>;
  const docs = unwrap(assets) as unknown as Array<{
    id: string;
    name: string;
    branches: { name: string; head_checkpoint_id: string } | null;
  }>;
  const { data: signed } = cps.length
    ? await supabase.storage.from("previews").createSignedUrls(
        cps.map((c) => c.preview_path),
        600,
      )
    : { data: [] };
  const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return Response.json({
    role,
    direction: {
      id: direction.id,
      name: direction.name,
      description: direction.description,
      createdAt: direction.created_at,
    },
    entries: entries.map((e) => {
      const cp = cps.find((c) => c.id === e.checkpoint_id);
      const doc = docs.find((d) => d.id === e.asset_id);
      return {
        assetId: e.asset_id,
        assetName: doc?.name ?? "Deleted document",
        checkpointId: e.checkpoint_id,
        message: cp?.message ?? null,
        createdAt: cp?.created_at ?? null,
        previewUrl: cp ? (urls.get(cp.preview_path) ?? null) : null,
        activeBranch: doc?.branches?.name ?? null,
        isCurrent: doc?.branches?.head_checkpoint_id === e.checkpoint_id,
      };
    }),
  });
});

/** Deletes a direction and its card. The versions it named stay in each document's history. */
export const DELETE = handler(async (_request: Request, ctx: Ctx) => {
  const { projectId, directionId } = await ctx.params;
  const { user, supabase } = await requireUser();
  await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
  unwrap(
    await supabase
      .from("canvas_items")
      .delete()
      .eq("project_id", projectId)
      .eq("item_type", "direction")
      .eq("ref_id", directionId),
  );
  unwrap(
    await supabase.from("directions").delete().eq("id", directionId).eq("project_id", projectId),
  );
  return new Response(null, { status: 204 });
});
