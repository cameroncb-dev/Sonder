import { PairPollRequest, type PairPollResponse } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { CONNECTOR_TOKEN_TTL_MS, newSecret, sha256 } from "@/server/connector-auth";
import { handler, HttpError, parseJson } from "@/server/http";

/**
 * The plugin polls until a user approves its code. The token is issued exactly
 * once: the conditional update consumes the poll secret.
 */
export const POST = handler(async (request: Request) => {
  const { sessionId, pollSecret } = await parseJson(request, PairPollRequest);
  const admin = createAdminClient();
  const token = newSecret();
  const expiresAt = new Date(Date.now() + CONNECTOR_TOKEN_TTL_MS).toISOString();

  const { data: activated } = await admin
    .from("connector_sessions")
    .update({
      status: "active",
      token_hash: sha256(token),
      expires_at: expiresAt,
      pairing_code: null,
      pairing_secret_hash: null,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("status", "approved")
    .eq("pairing_secret_hash", sha256(pollSecret))
    .gt("pairing_expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();

  if (activated) {
    const { data: user } = await admin.auth.admin.getUserById(activated.user_id);
    const body: PairPollResponse = {
      status: "active",
      token,
      expiresAt,
      user: { id: activated.user_id, ...(user.user?.email ? { email: user.user.email } : {}) },
    };
    return Response.json(body);
  }

  const { data: session } = await admin
    .from("connector_sessions")
    .select("status,pairing_secret_hash,pairing_expires_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.pairing_secret_hash !== sha256(pollSecret)) {
    throw new HttpError(401, "UNAUTHENTICATED", "Unknown pairing session");
  }
  const expired =
    !session.pairing_expires_at || new Date(session.pairing_expires_at).getTime() <= Date.now();
  const body: PairPollResponse = { status: expired ? "expired" : "pending" };
  return Response.json(body);
});
