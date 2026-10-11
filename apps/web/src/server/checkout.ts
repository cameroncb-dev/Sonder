import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { unwrap } from "./http";
import type { AssetRow } from "./projects";

interface Checkpoint {
  id: string;
  manifest: {
    files: { native: { name: string; bytes: number; digest: string } };
    elements: unknown[];
  };
}

/**
 * Queues an openCheckpoint job that opens a branch's head as a working copy. The active branch
 * changes only if the connector succeeds, and it refuses when the open document has unsaved
 * or uncaptured work (unless forced).
 */
export async function queueCheckout(
  supabase: SupabaseClient,
  projectId: string,
  asset: AssetRow,
  branch: { id: string; name: string; head_checkpoint_id: string },
  options: { force?: boolean; operationId?: string } = {},
) {
  const ids = [branch.head_checkpoint_id];
  const current = asset.active_branch_id
    ? (unwrap(
        await supabase
          .from("branches")
          .select("head_checkpoint_id")
          .eq("id", asset.active_branch_id)
          .single(),
      ) as { head_checkpoint_id: string })
    : null;
  if (current) ids.push(current.head_checkpoint_id);
  const checkpoints = unwrap(
    await supabase.from("checkpoints").select("id,manifest").in("id", ids),
  ) as Checkpoint[];
  const target = checkpoints.find((c) => c.id === branch.head_checkpoint_id)!;
  const currentHead = current
    ? checkpoints.find((c) => c.id === current.head_checkpoint_id)
    : undefined;

  return unwrap(
    await supabase.rpc("create_job", {
      p_project_id: projectId,
      p_asset_id: asset.id,
      p_operation: "openCheckpoint",
      p_operation_id: options.operationId ?? `checkout-${randomUUID()}`,
      p_params: {
        branchId: branch.id,
        branchName: branch.name,
        assetName: asset.name,
        checkpointId: target.id,
        native: target.manifest.files.native,
        // Lets the connector detect work that was never captured before it closes the document.
        currentHeadElements: currentHead?.manifest.elements ?? null,
        force: options.force ?? false,
      },
      p_requires_asset_session: false,
    }),
  ) as { id: string; status: string };
}
