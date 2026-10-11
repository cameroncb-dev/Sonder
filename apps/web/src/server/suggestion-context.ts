import type { Element, ElementKindCapability } from "@sonder/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/server";

import { HttpError, unwrap } from "./http";
import type { AssetRow } from "./projects";
import { SUGGESTION_FONTS } from "./suggestions";
import { projectCapabilities } from "./themes";

/** The document's current version and what the connector can change on it. */
export async function suggestionContext(supabase: SupabaseClient, asset: AssetRow) {
  if (!asset.active_branch_id)
    throw new HttpError(
      409,
      "NO_HISTORY",
      "Capture the document once before asking for suggestions",
    );
  const branch = unwrap(
    await supabase
      .from("branches")
      .select("id,name,head_checkpoint_id")
      .eq("id", asset.active_branch_id)
      .single(),
  ) as { id: string; name: string; head_checkpoint_id: string };
  const head = unwrap(
    await supabase
      .from("checkpoints")
      .select("id,preview_path,manifest")
      .eq("id", branch.head_checkpoint_id)
      .single(),
  ) as {
    id: string;
    preview_path: string;
    manifest: { elements?: Element[] } & Record<string, unknown>;
  };
  const caps = (await projectCapabilities(asset.project_id)).get(asset.application);
  if (!caps?.operations.includes("createCandidate"))
    throw new HttpError(
      409,
      "UNSUPPORTED",
      `The ${asset.application} connector can't build candidates`,
    );
  const elements = head.manifest.elements ?? [];
  const used = elements.flatMap((e) =>
    e.properties
      .filter((p) => p.type === "text.font")
      .map((p) => (p.value as { postScriptName: string }).postScriptName),
  );
  return {
    branch,
    head,
    elements,
    elementKinds: caps.elementKinds as ElementKindCapability[],
    identityFields: caps.identityFields,
    fonts: [...new Set([...SUGGESTION_FONTS, ...used])],
  };
}

/** The current version's preview image, if small enough to send. */
export async function previewBytes(path: string): Promise<Uint8Array | null> {
  const { data } = await createAdminClient().storage.from("previews").download(path);
  if (!data || data.size > 4 * 1024 * 1024) return null;
  return new Uint8Array(await data.arrayBuffer());
}
