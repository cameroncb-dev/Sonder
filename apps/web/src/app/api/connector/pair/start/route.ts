import { PairStartRequest, type PairStartResponse } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { newPairingCode, newSecret, PAIRING_TTL_MS, sha256 } from "@/server/connector-auth";
import { handler, parseJson, unwrap } from "@/server/http";

/** Starts device pairing. Unauthenticated: the session stays powerless until a user approves its code. */
export const POST = handler(async (request: Request) => {
  const { manifest } = await parseJson(request, PairStartRequest);
  const pollSecret = newSecret();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  const admin = createAdminClient();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPairingCode();
    const { data, error } = await admin
      .from("connector_sessions")
      .insert({
        application: manifest.application,
        connector_version: manifest.connectorVersion,
        application_version: manifest.applicationVersion ?? null,
        capabilities: manifest,
        status: "pending",
        pairing_code: code,
        pairing_secret_hash: sha256(pollSecret),
        pairing_expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error?.code === "23505") continue; // code collision; try another
    const session = unwrap({ data, error });
    const body: PairStartResponse = { sessionId: session.id, code, pollSecret, expiresAt };
    return Response.json(body, { status: 201 });
  }
  throw new Error("Could not allocate a pairing code");
});
