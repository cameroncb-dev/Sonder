import { randomUUID } from "node:crypto";

import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { buildChangeSet, computeCombination, connectorCapabilities } from "@/server/combine";
import { handler, parseJson, unwrap } from "@/server/http";
import { requireAsset } from "@/server/projects";

interface ProposalRow {
  id: string;
  status: string;
  request: Record<string, unknown>;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  proposal_items: Array<{
    id: string;
    status: string;
    candidate_checkpoint_id: string | null;
    source_checkpoint_ids: string[];
    outcome: Record<string, unknown> | null;
  }>;
}

/** Combination proposals for one asset, newest first, with candidate previews. */
export const GET = handler(
  async (
    _request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/proposals">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor", "reviewer"]);
    await requireAsset(supabase, projectId, assetId);

    const proposals = unwrap(
      await supabase
        .from("proposals")
        .select(
          "id,status,request,created_by,approved_by,approved_at,created_at," +
            "proposal_items!inner(id,status,candidate_checkpoint_id,source_checkpoint_ids,outcome)",
        )
        .eq("project_id", projectId)
        .eq("kind", "branch_combination")
        .eq("proposal_items.asset_id", assetId)
        .order("created_at", { ascending: false })
        .limit(20),
    ) as unknown as ProposalRow[];

    const candidateIds = proposals
      .map((p) => p.proposal_items[0]?.candidate_checkpoint_id)
      .filter((id): id is string => !!id);
    const candidates = candidateIds.length
      ? (unwrap(
          await supabase
            .from("checkpoints")
            .select("id,preview_path,preview_digest,manifest")
            .in("id", candidateIds),
        ) as Array<{
          id: string;
          preview_path: string;
          preview_digest: string;
          manifest: { elements?: unknown[] };
        }>)
      : [];
    const { data: signed } = candidates.length
      ? await supabase.storage.from("previews").createSignedUrls(
          candidates.map((c) => c.preview_path),
          600,
        )
      : { data: [] };
    const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

    return Response.json({
      proposals: proposals.map((p) => {
        const item = p.proposal_items[0]!;
        const candidate = candidates.find((c) => c.id === item.candidate_checkpoint_id);
        return {
          id: p.id,
          status: p.status,
          request: p.request,
          createdBy: p.created_by,
          createdAt: p.created_at,
          approvedBy: p.approved_by,
          approvedAt: p.approved_at,
          item: {
            id: item.id,
            status: item.status,
            outcome: item.outcome,
            sourceCheckpointIds: item.source_checkpoint_ids,
          },
          candidate: candidate
            ? {
                id: candidate.id,
                previewUrl: urls.get(candidate.preview_path) ?? null,
                previewDigest: candidate.preview_digest,
                elements: candidate.manifest.elements ?? [],
              }
            : null,
        };
      }),
    });
  },
);

/**
 * Proposes combining the source branch into the target branch with the given selections.
 * The merge is recomputed here from the current branch heads, so the proposal is bound to
 * exactly the checkpoints it was computed from; a connector then builds the candidate.
 */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/proposals">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const asset = await requireAsset(supabase, projectId, assetId);
    const body = await parseJson(
      request,
      z.object({
        targetBranchId: z.uuid(),
        sourceBranchId: z.uuid(),
        baseCheckpointId: z.uuid().optional(),
        resolutions: z.record(z.string(), z.enum(["target", "source"])).default({}),
        operationId: z.string().min(8).max(200).optional(),
      }),
    );

    const combination = await computeCombination(supabase, asset, body);
    const { identityFields } = await connectorCapabilities(asset.application, projectId);
    const { changeSet, choices } = buildChangeSet(combination, body.resolutions, identityFields);
    const { target, source, base } = combination;

    const created = unwrap(
      await supabase.rpc("create_combination_proposal", {
        p_project_id: projectId,
        p_asset_id: assetId,
        p_request: {
          targetBranchId: target.branch.id,
          targetBranchName: target.branch.name,
          targetCheckpointId: target.checkpoint.id,
          sourceBranchId: source.branch.id,
          sourceBranchName: source.branch.name,
          sourceCheckpointId: source.checkpoint.id,
          baseCheckpointId: base.checkpoint.id,
          baseChosen: base.chosen,
          choices,
          changeSet,
        },
        p_operation_id: body.operationId ?? `combine-${randomUUID()}`,
        p_job_params: {
          message: `Combine ${source.branch.name} into ${target.branch.name}`,
          targetCheckpoint: { id: target.checkpoint.id, manifest: target.checkpoint.manifest },
          changeSet,
        },
      }),
    ) as { proposal: { id: string }; item: { id: string }; job: { id: string } };
    return Response.json(created, { status: 201 });
  },
);
