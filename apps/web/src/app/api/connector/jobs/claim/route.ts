import type { ClaimResponse } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, unwrap } from "@/server/http";

/** Leases the next compatible job for this session, after reconciling expired leases. */
export const POST = handler(async (request: Request) => {
  const session = await requireConnectorSession(request);
  const admin = createAdminClient();
  const job = unwrap(
    await admin.rpc("claim_job", { p_session_id: session.id, p_lease_seconds: 120 }),
  ) as {
    id: string | null;
    project_id: string;
    asset_id: string | null;
    operation: string;
    operation_id: string;
    params: Record<string, unknown>;
    attempts: number;
    lease_expires_at: string;
  } | null;
  if (!job?.id) return Response.json({ job: null } satisfies ClaimResponse);

  const asset = job.asset_id
    ? (unwrap(
        await admin.from("assets").select("native_locator").eq("id", job.asset_id).single(),
      ) as {
        native_locator: Record<string, unknown>;
      })
    : null;
  const body: ClaimResponse = {
    job: {
      id: job.id,
      projectId: job.project_id,
      assetId: job.asset_id,
      operation: job.operation,
      operationId: job.operation_id,
      params: job.params,
      attempt: job.attempts,
      leaseExpiresAt: new Date(job.lease_expires_at).toISOString(),
      assetLocator: asset?.native_locator ?? null,
    },
  };
  return Response.json(body);
});
