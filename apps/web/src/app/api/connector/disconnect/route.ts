import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, unwrap } from "@/server/http";

/** Ends this connector session on the server, so its token stops working at once. */
export const POST = handler(async (request: Request) => {
  const session = await requireConnectorSession(request);
  unwrap(
    await createAdminClient()
      .from("connector_sessions")
      .update({ status: "revoked" })
      .eq("id", session.id),
  );
  return new Response(null, { status: 204 });
});
