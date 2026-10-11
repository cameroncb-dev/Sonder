import { RefreshRequest, type RefreshResponse } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { issueTokens, sha256 } from "@/server/connector-auth";
import { handler, HttpError, parseJson } from "@/server/http";

/**
 * Exchanges a refresh token for a new access/refresh pair. The update only matches the
 * current, unexpired refresh token of an active session, so each refresh token works once
 * and a revoked (disconnected) session can't be renewed.
 */
export const POST = handler(async (request: Request) => {
  const { refreshToken } = await parseJson(request, RefreshRequest);
  const tokens = issueTokens();
  const { data } = await createAdminClient()
    .from("connector_sessions")
    .update({ ...tokens.columns, last_seen_at: new Date().toISOString() })
    .eq("refresh_token_hash", sha256(refreshToken))
    .eq("status", "active")
    .gt("refresh_expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (!data)
    throw new HttpError(401, "REFRESH_INVALID", "This connection has ended; connect again");
  const body: RefreshResponse = tokens.body;
  return Response.json(body);
});
