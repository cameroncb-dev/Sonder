import { randomUUID } from "node:crypto";

import {
  type MergeResult,
  mergeBases,
  mergeElements,
  nativeIdentity,
  planCombination,
  type Resolutions,
} from "@sonder/connector-sdk";
import type { ChangeSet, Element, ElementKindCapability } from "@sonder/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/server";

import { HttpError, unwrap } from "./http";
import type { AssetRow } from "./projects";

interface CheckpointRow {
  id: string;
  message: string | null;
  created_at: string;
  status: string;
  proposal_item_id: string | null;
  manifest: { elements?: Element[]; files: { native: { name: string } } } & Record<string, unknown>;
}

interface BranchRow {
  id: string;
  name: string;
  head_checkpoint_id: string;
}

export interface CombinationInput {
  targetBranchId: string;
  sourceBranchId: string;
  /** Required when the branches have no single shared ancestor. */
  baseCheckpointId?: string;
}

export interface Combination {
  target: { branch: BranchRow; checkpoint: CheckpointRow };
  source: { branch: BranchRow; checkpoint: CheckpointRow };
  base: { checkpoint: CheckpointRow; chosen: boolean };
  merge: MergeResult;
}

/** What the connector for an application can edit and how it identifies elements. */
async function connectorCapabilities(application: string, projectId: string) {
  const admin = createAdminClient();
  const members = (
    unwrap(
      await admin.from("project_members").select("user_id").eq("project_id", projectId),
    ) as Array<{ user_id: string }>
  ).map((m) => m.user_id);
  const latest = unwrap(
    await admin
      .from("connector_sessions")
      .select("capabilities")
      .eq("application", application)
      .in("user_id", members)
      .not("last_seen_at", "is", null)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ) as {
    capabilities: { elementKinds?: ElementKindCapability[]; identityFields?: string[] };
  } | null;
  if (!latest)
    throw new HttpError(
      409,
      "CONNECTOR_UNKNOWN",
      `Connect the ${application} plugin once so Sonder knows what it can edit`,
    );
  return {
    elementKinds: latest.capabilities.elementKinds ?? [],
    identityFields: latest.capabilities.identityFields,
  };
}

/**
 * Loads the branches and checkpoints a combination is bound to and runs the merge engine.
 * Candidate checkpoints of unfinished proposals are not part of history and can't be used.
 */
export async function computeCombination(
  supabase: SupabaseClient,
  asset: AssetRow,
  input: CombinationInput,
): Promise<Combination> {
  if (input.targetBranchId === input.sourceBranchId)
    throw new HttpError(400, "INVALID_PARAMETER", "Choose two different branches");
  const branches = unwrap(
    await supabase
      .from("branches")
      .select("id,name,head_checkpoint_id")
      .eq("asset_id", asset.id)
      .in("id", [input.targetBranchId, input.sourceBranchId]),
  ) as BranchRow[];
  const targetBranch = branches.find((b) => b.id === input.targetBranchId);
  const sourceBranch = branches.find((b) => b.id === input.sourceBranchId);
  if (!targetBranch || !sourceBranch)
    throw new HttpError(404, "NOT_FOUND", "Both branches must belong to this asset");

  const parentRows = unwrap(
    await supabase
      .from("checkpoint_parents")
      .select("checkpoint_id,parent_id")
      .eq("asset_id", asset.id),
  ) as Array<{ checkpoint_id: string; parent_id: string }>;
  const parents = new Map<string, string[]>();
  for (const r of parentRows)
    parents.set(r.checkpoint_id, [...(parents.get(r.checkpoint_id) ?? []), r.parent_id]);

  let baseId = input.baseCheckpointId;
  if (!baseId) {
    const bases = mergeBases(
      parents,
      targetBranch.head_checkpoint_id,
      sourceBranch.head_checkpoint_id,
    );
    if (bases.length !== 1)
      throw new HttpError(
        409,
        "BASELINE_REQUIRED",
        bases.length
          ? "These branches have more than one shared ancestor; choose a baseline checkpoint"
          : "These branches share no history; choose a baseline checkpoint",
        { candidates: bases },
      );
    baseId = bases[0]!;
  }

  const ids = [
    ...new Set([baseId, targetBranch.head_checkpoint_id, sourceBranch.head_checkpoint_id]),
  ];
  const checkpoints = unwrap(
    await supabase
      .from("checkpoints")
      .select("id,message,created_at,status,proposal_item_id,manifest")
      .eq("asset_id", asset.id)
      .eq("status", "finalized")
      .in("id", ids),
  ) as CheckpointRow[];
  const byId = new Map(checkpoints.map((c) => [c.id, c]));
  const base = byId.get(baseId);
  if (!base) throw new HttpError(404, "NOT_FOUND", "Baseline checkpoint not found on this asset");
  const target = byId.get(targetBranch.head_checkpoint_id)!;
  const source = byId.get(sourceBranch.head_checkpoint_id)!;

  const capabilities = await connectorCapabilities(asset.application, asset.project_id);
  const merge = mergeElements(
    base.manifest.elements ?? [],
    target.manifest.elements ?? [],
    source.manifest.elements ?? [],
    capabilities,
  );
  return {
    target: { branch: targetBranch, checkpoint: target },
    source: { branch: sourceBranch, checkpoint: source },
    base: { checkpoint: base, chosen: !!input.baseCheckpointId },
    merge,
  };
}

/**
 * Turns the user's selections into a change set against the target checkpoint. Elements are
 * mapped by the target's native refs, so the connector edits exactly the matched objects.
 */
export function buildChangeSet(
  combination: Combination,
  resolutions: Resolutions,
  identityFields: string[] | undefined,
) {
  const plan = planCombination(combination.merge, resolutions);
  if (plan.issues.length)
    throw new HttpError(422, plan.issues[0]!.code, plan.issues.map((i) => i.message).join("; "), {
      issues: plan.issues,
    });
  if (!plan.changes.length)
    throw new HttpError(
      422,
      "NOTHING_TO_COMBINE",
      "The selected result is identical to the target; nothing to combine",
    );

  const targetElements = combination.target.checkpoint.manifest.elements ?? [];
  const mappings: ChangeSet["mappings"] = [];
  const elementIds = new Map<string, string>();
  for (const change of plan.changes) {
    if (elementIds.has(change.key)) continue;
    const element = targetElements.find(
      (e) => nativeIdentity(e.native, identityFields) === change.key,
    )!;
    const elementId = randomUUID();
    elementIds.set(change.key, elementId);
    mappings.push({
      elementId,
      role: `element_${mappings.length + 1}`,
      kind: element.kind,
      native: element.native,
    });
  }
  const changeSet: ChangeSet = {
    mappings,
    changes: plan.changes.map((c) => ({ elementId: elementIds.get(c.key)!, property: c.property })),
  };
  return { changeSet, choices: plan.choices };
}

export { connectorCapabilities };
