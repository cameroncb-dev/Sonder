import { LinkAssetRequest } from "@sonder/contracts";

import { createAdminClient } from "@/lib/supabase/server";
import { requireConnectorSession } from "@/server/connector-auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";

const COLUMNS = "id,name,project_id,native_locator";

/** Connects the plugin's open document to a project as an asset (idempotent per path). */
export const POST = handler(async (request: Request) => {
  const session = await requireConnectorSession(request);
  const body = await parseJson(request, LinkAssetRequest);
  const admin = createAdminClient();
  const canEdit = unwrap(
    await admin.rpc("user_can_edit", { p_user_id: session.userId, p_project_id: body.projectId }),
  );
  if (!canEdit) throw new HttpError(403, "FORBIDDEN", "The paired user cannot edit this project");

  const find = async () =>
    unwrap(
      await admin
        .from("assets")
        .select(COLUMNS)
        .eq("project_id", body.projectId)
        .eq("application", session.application)
        .eq("native_locator->>path", body.path)
        .maybeSingle(),
    );
  const existing = await find();
  if (existing) return Response.json({ asset: existing });

  // An older file of a tracked document (its original, or a previous branch working copy).
  const former = unwrap(
    await admin
      .from("assets")
      .select("id,name,native_locator")
      .eq("project_id", body.projectId)
      .eq("application", session.application)
      .contains("known_paths", [body.path])
      .limit(1)
      .maybeSingle(),
  ) as { id: string; name: string; native_locator: { path?: string } } | null;
  if (former)
    throw new HttpError(
      409,
      "ALREADY_TRACKED",
      `This file is an earlier version of "${former.name}", which Sonder now tracks as ${
        former.native_locator.path?.split("/").pop() ?? "another file"
      }. Edit that file instead, or switch branches from the canvas.`,
      { assetId: former.id, currentPath: former.native_locator.path ?? null },
    );

  const { data: asset, error } = await admin
    .from("assets")
    .insert({
      project_id: body.projectId,
      application: session.application,
      name: body.name,
      native_locator: { path: body.path },
      created_by: session.userId,
    })
    .select(COLUMNS)
    .single();
  // A concurrent link of the same document won the unique index; return its asset.
  if (error?.code === "23505") return Response.json({ asset: await find() });
  return Response.json({ asset: unwrap({ data: asset, error }) }, { status: 201 });
});
