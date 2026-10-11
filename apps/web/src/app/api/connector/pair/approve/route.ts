import { PairApproveRequest } from "@sonder/contracts";

import { requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";

/** A signed-in user approves the code shown in the plugin panel. */
export const POST = handler(async (request: Request) => {
  const { supabase } = await requireUser();
  const { code } = await parseJson(request, PairApproveRequest);
  const session = unwrap(await supabase.rpc("approve_pairing", { p_code: code }));
  return Response.json({
    session: {
      id: session.id,
      application: session.application,
      applicationVersion: session.application_version,
    },
  });
});
