import { fnv1a64 } from "@sonder/connector-sdk";
import { CheckpointManifest } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, HttpError, unwrap } from "@/server/http";

interface CheckpointRow {
  id: string;
  project_id: string;
  asset_id: string;
  status: "pending" | "finalized";
  session_id: string | null;
  manifest: unknown;
}

const BUCKETS = { native: "snapshots", preview: "previews" } as const;
/** Matches the bucket limits in supabase/migrations. */
const MAX_BYTES = { native: 50 * 1024 * 1024, preview: 20 * 1024 * 1024 } as const;

/**
 * Receives one checkpoint file as the raw request body, verifies its size and
 * digest against the manifest, and stores it privately. Only the backend can
 * write snapshots and previews.
 */
export const PUT = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/connector/checkpoints/[checkpointId]/files/[kind]">,
  ) => {
    const { checkpointId, kind } = await ctx.params;
    if (kind !== "native" && kind !== "preview")
      throw new HttpError(404, "NOT_FOUND", "Unknown file kind");
    const session = await requireConnectorSession(request);
    const admin = createAdminClient();

    const checkpoint = unwrap(
      await admin
        .from("checkpoints")
        .select("id,project_id,asset_id,status,session_id,manifest")
        .eq("id", checkpointId)
        .maybeSingle(),
    ) as CheckpointRow | null;
    if (!checkpoint || checkpoint.session_id !== session.id) {
      throw new HttpError(404, "NOT_FOUND", "Checkpoint not found for this session");
    }
    if (checkpoint.status === "finalized")
      return Response.json({ stored: true, alreadyFinalized: true });

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES[kind])
      throw new HttpError(413, "TOO_LARGE", "File exceeds the size limit");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_BYTES[kind])
      throw new HttpError(413, "TOO_LARGE", "File exceeds the size limit");

    const expected = CheckpointManifest.parse(checkpoint.manifest).files[kind];
    const digest = fnv1a64(bytes);
    if (bytes.length !== expected.bytes || digest !== expected.digest) {
      throw new HttpError(422, "DIGEST_MISMATCH", "File does not match the checkpoint manifest", {
        expected: { bytes: expected.bytes, digest: expected.digest },
        received: { bytes: bytes.length, digest },
      });
    }

    const path = `${checkpoint.project_id}/${checkpoint.asset_id}/${checkpoint.id}/${expected.name}`;
    const { error } = await admin.storage
      .from(BUCKETS[kind])
      .upload(path, bytes, { contentType: expected.mediaType, upsert: true });
    if (error) throw new HttpError(502, "STORAGE_ERROR", `Upload failed: ${error.message}`);

    unwrap(
      await admin.rpc("record_checkpoint_file", {
        p_session_id: session.id,
        p_checkpoint_id: checkpoint.id,
        p_kind: kind,
        p_path: path,
        p_bytes: bytes.length,
        p_digest: digest,
      }),
    );
    return Response.json({ stored: true, path });
  },
);
