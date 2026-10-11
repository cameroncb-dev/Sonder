import { LinkAssetRequest } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";

/** Connects the plugin's open document to a project as an asset (idempotent per path). */
export const POST = handler(async (request: Request) => {
  const session = await requireConnectorSession(request);
  const body = await parseJson(request, LinkAssetRequest);
  const admin = createAdminClient();
  const canEdit = unwrap(
    await admin.rpc("user_can_edit", { p_user_id: session.userId, p_project_id: body.projectId }),
  );
  if (!canEdit) throw new HttpError(403, "FORBIDDEN", "The paired user cannot edit this project");

  const existing = unwrap(
    await admin
      .from("assets")
      .select("id,name,project_id,native_locator")
      .eq("project_id", body.projectId)
      .eq("application", session.application)
      .eq("native_locator->>path", body.path)
      .maybeSingle(),
  );
  if (existing) return Response.json({ asset: existing });

  const asset = unwrap(
    await admin
      .from("assets")
      .insert({
        project_id: body.projectId,
        application: session.application,
        name: body.name,
        native_locator: { path: body.path },
        created_by: session.userId,
      })
      .select("id,name,project_id,native_locator")
      .single(),
  );
  return Response.json({ asset }, { status: 201 });
});
