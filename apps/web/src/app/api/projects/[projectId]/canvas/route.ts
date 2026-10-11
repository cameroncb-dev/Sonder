import { createAdminClient } from "@/lib/supabase/server";
import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, unwrap } from "@/server/http";
import { type AssetRow, connectorStatus } from "@/server/projects";

const GRID = { x: 80, y: 80, dx: 320, dy: 260 };

/** Everything the canvas needs in one request. Missing asset cards are placed beside existing cards. */
export const GET = handler(
  async (_request: Request, ctx: RouteContext<"/api/projects/[projectId]/canvas">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    const role = await requireProjectRole(supabase, user.id, projectId, [
      "owner",
      "editor",
      "reviewer",
    ]);

    const project = unwrap(
      await supabase.from("projects").select("id,name").eq("id", projectId).single(),
    );
    const assets = unwrap(
      await supabase
        .from("assets")
        .select("id,project_id,name,application,native_locator,active_branch_id")
        .eq("project_id", projectId)
        .order("created_at"),
    ) as AssetRow[];
    let items = unwrap(
      await supabase.from("canvas_items").select("*").eq("project_id", projectId),
    ) as Array<Record<string, unknown>>;

    const placed = new Set(items.filter((i) => i.item_type === "asset").map((i) => i.ref_id));
    const missing = assets.filter((a) => !placed.has(a.id));
    if (missing.length) {
      // Card placement is presentation data derived from assets, so the backend creates it for any member.
      // Start a row to the right of the existing content so new cards land near what people see.
      const xs = items.map((i) => Number(i.x));
      const ys = items.map((i) => Number(i.y));
      const origin = items.length
        ? { x: Math.round(Math.max(...xs) + GRID.dx), y: Math.round(Math.min(...ys)) }
        : { x: GRID.x, y: GRID.y };
      // Concurrent loads may race to place the same card; the unique index keeps one.
      const created = unwrap(
        await createAdminClient()
          .from("canvas_items")
          .upsert(
            missing.map((asset, i) => ({
              project_id: projectId,
              item_type: "asset",
              ref_id: asset.id,
              x: origin.x + i * GRID.dx,
              y: origin.y,
            })),
            { onConflict: "project_id,ref_id", ignoreDuplicates: true },
          )
          .select("*"),
      ) as Array<Record<string, unknown>>;
      items = [...items, ...created];
    }

    const connections = unwrap(
      await supabase
        .from("canvas_connections")
        .select("id,from_item_id,to_item_id,label")
        .eq("project_id", projectId),
    );
    const branchIds = assets.map((a) => a.active_branch_id).filter((id): id is string => !!id);
    const branches = branchIds.length
      ? (unwrap(
          await supabase.from("branches").select("id,name,head_checkpoint_id").in("id", branchIds),
        ) as Array<{ id: string; name: string; head_checkpoint_id: string }>)
      : [];
    const heads = branches.map((b) => b.head_checkpoint_id);
    const headRows = heads.length
      ? (unwrap(
          await supabase.from("checkpoints").select("id,preview_path").in("id", heads),
        ) as Array<{ id: string; preview_path: string }>)
      : [];
    const references = items
      .filter((i) => i.item_type === "reference")
      .map((i) => (i.content as { path?: string }).path)
      .filter((p): p is string => !!p);

    const sign = async (bucket: string, paths: string[]) => {
      if (!paths.length) return new Map<string, string>();
      const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 600);
      return new Map(
        (data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]),
      );
    };
    const previewUrls = await sign(
      "previews",
      headRows.map((h) => h.preview_path),
    );
    const referenceUrls = await sign("references", references);
    const status = await connectorStatus(projectId, assets);
    const themes = unwrap(
      await supabase
        .from("themes")
        .select("id,name,colors")
        .eq("project_id", projectId)
        .order("created_at"),
    );

    return Response.json({
      project,
      role,
      themes,
      assets: assets.map((asset) => {
        const branch = branches.find((b) => b.id === asset.active_branch_id);
        const head = headRows.find((h) => h.id === branch?.head_checkpoint_id);
        return {
          id: asset.id,
          name: asset.name,
          application: asset.application,
          path: (asset.native_locator.path as string | undefined) ?? null,
          activeBranch: branch
            ? { id: branch.id, name: branch.name, headCheckpointId: branch.head_checkpoint_id }
            : null,
          headPreviewUrl: head ? (previewUrls.get(head.preview_path) ?? null) : null,
          connector: status[asset.id],
        };
      }),
      items: items.map((item) => ({
        ...item,
        ...(item.item_type === "reference"
          ? { url: referenceUrls.get((item.content as { path?: string }).path ?? "") ?? null }
          : {}),
      })),
      connections,
    });
  },
);
