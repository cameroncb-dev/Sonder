import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";
import { requireAsset } from "@/server/projects";
import { suggestionContext } from "@/server/suggestion-context";
import { suggestionChangeSet } from "@/server/suggestions";

const Change = z.object({
  elementKey: z.string().min(1).max(500),
  element: z.string().max(300),
  property: z.enum(["text.content", "text.font", "text.size", "text.color", "fill.color"]),
  from: z.unknown().optional(),
  to: z.unknown(),
});

/**
 * Builds a suggestion as a candidate in the application, from the document's current
 * version. The changes are re-validated here; the plugin re-checks them in the document.
 */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/suggestions/try">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const asset = await requireAsset(supabase, projectId, assetId);
    const body = await parseJson(
      request,
      z.object({
        title: z.string().min(1).max(60),
        rationale: z.string().max(300).default(""),
        changes: z.array(Change).min(1).max(8),
      }),
    );
    const c = await suggestionContext(supabase, asset);
    let changeSet;
    try {
      changeSet = suggestionChangeSet(body.changes, c);
    } catch (error) {
      throw new HttpError(409, "STALE", error instanceof Error ? error.message : String(error));
    }
    const created = unwrap(
      await supabase.rpc("create_suggestion_proposal", {
        p_project_id: projectId,
        p_asset_id: assetId,
        p_request: {
          title: body.title,
          rationale: body.rationale,
          changes: body.changes,
          branchId: c.branch.id,
          checkpointId: c.head.id,
        },
        p_job_params: {
          message: `Suggestion: ${body.title}`,
          targetCheckpoint: { id: c.head.id, manifest: c.head.manifest },
          changeSet,
        },
      }),
    );
    return Response.json(created, { status: 201 });
  },
);
