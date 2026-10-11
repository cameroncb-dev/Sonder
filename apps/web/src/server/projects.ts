import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/server";

import { HttpError, unwrap } from "./http";

export interface AssetRow {
  id: string;
  project_id: string;
  name: string;
  application: string;
  native_locator: Record<string, unknown>;
  active_branch_id: string | null;
}

export async function requireAsset(
  supabase: SupabaseClient,
  projectId: string,
  assetId: string,
): Promise<AssetRow> {
  const asset = unwrap(
    await supabase
      .from("assets")
      .select("id,project_id,name,application,native_locator,active_branch_id")
      .eq("id", assetId)
      .eq("project_id", projectId)
      .maybeSingle(),
  ) as AssetRow | null;
  if (!asset) throw new HttpError(404, "NOT_FOUND", "Asset not found");
  return asset;
}

export interface ConnectorStatus {
  online: boolean;
  lastSeenAt: string | null;
  /** From the most recent connector manifest seen for this application in the project. */
  capabilities: {
    connectorVersion?: string;
    applicationVersion?: string;
    operations: string[];
    elementKinds: unknown[];
  } | null;
}

/**
 * Connector presence per asset. Session rows are backend-only, so this uses the
 * admin client after the caller has checked project membership.
 */
export async function connectorStatus(
  projectId: string,
  assets: AssetRow[],
): Promise<Record<string, ConnectorStatus>> {
  const admin = createAdminClient();
  const ids = assets.map((a) => a.id);
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const open = ids.length
    ? (unwrap(
        await admin
          .from("session_assets")
          .select("asset_id,reported_at,connector_sessions(status,expires_at)")
          .in("asset_id", ids)
          .gt("reported_at", since),
      ) as unknown as Array<{
        asset_id: string;
        reported_at: string;
        connector_sessions: { status: string; expires_at: string };
      }>)
    : [];
  const members = (
    unwrap(
      await admin.from("project_members").select("user_id").eq("project_id", projectId),
    ) as Array<{ user_id: string }>
  ).map((m) => m.user_id);
  const applications = [...new Set(assets.map((a) => a.application))];
  const manifests = new Map<
    string,
    ConnectorStatus["capabilities"] & { lastSeenAt: string | null }
  >();
  for (const application of applications) {
    const latest = unwrap(
      await admin
        .from("connector_sessions")
        .select("capabilities,last_seen_at")
        .eq("application", application)
        .in("user_id", members)
        .not("last_seen_at", "is", null)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ) as { capabilities: Record<string, unknown>; last_seen_at: string } | null;
    if (latest) {
      const c = latest.capabilities;
      manifests.set(application, {
        connectorVersion: c.connectorVersion as string | undefined,
        applicationVersion: c.applicationVersion as string | undefined,
        operations: (c.operations as string[]) ?? [],
        elementKinds: (c.elementKinds as unknown[]) ?? [],
        lastSeenAt: latest.last_seen_at,
      });
    }
  }

  const now = Date.now();
  return Object.fromEntries(
    assets.map((asset) => {
      const live = open.filter(
        (o) =>
          o.asset_id === asset.id &&
          o.connector_sessions.status === "active" &&
          new Date(o.connector_sessions.expires_at).getTime() > now,
      );
      const manifest = manifests.get(asset.application);
      return [
        asset.id,
        {
          online: live.length > 0,
          lastSeenAt: live[0]?.reported_at ?? manifest?.lastSeenAt ?? null,
          capabilities: manifest
            ? {
                connectorVersion: manifest.connectorVersion,
                applicationVersion: manifest.applicationVersion,
                operations: manifest.operations,
                elementKinds: manifest.elementKinds,
              }
            : null,
        },
      ];
    }),
  );
}
