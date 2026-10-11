import { randomUUID } from "node:crypto";

import { nativeIdentity } from "@sonder/connector-sdk";
import {
  type ChangeSet,
  type Element,
  type ElementKindCapability,
  type NativeRef,
  propertyValuesEqual,
  type PropertyValue,
} from "@sonder/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/server";

import { HttpError, unwrap } from "./http";

export const COLOR_ROLES = ["primary", "background", "text", "accent"] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

const Hex = z
  .string()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^#[0-9A-F]{6}$/, "Colors are #RRGGBB"));
export const ThemeColors = z.object({
  primary: Hex,
  background: Hex,
  text: Hex,
  accent: Hex,
});
export type ThemeColors = z.infer<typeof ThemeColors>;

/** Which property a theme color sets on each kind of element. */
const PROPERTY_FOR_KIND: Record<string, "text.color" | "fill.color"> = {
  text: "text.color",
  solid_fill: "fill.color",
};

interface Capabilities {
  application: string;
  operations: string[];
  elementKinds: ElementKindCapability[];
  identityFields?: string[];
  colorModes?: string[];
}

/** The latest connector manifest seen for each application among the project's members. */
export async function projectCapabilities(projectId: string): Promise<Map<string, Capabilities>> {
  const admin = createAdminClient();
  const members = (
    unwrap(
      await admin.from("project_members").select("user_id").eq("project_id", projectId),
    ) as Array<{ user_id: string }>
  ).map((m) => m.user_id);
  const sessions = unwrap(
    await admin
      .from("connector_sessions")
      .select("application,capabilities,last_seen_at")
      .in("user_id", members)
      .not("last_seen_at", "is", null)
      .order("last_seen_at", { ascending: false }),
  ) as Array<{ application: string; capabilities: Omit<Capabilities, "application"> }>;
  const result = new Map<string, Capabilities>();
  for (const s of sessions)
    if (!result.has(s.application))
      result.set(s.application, { application: s.application, ...s.capabilities });
  return result;
}

export interface AssetHead {
  id: string;
  name: string;
  application: string;
  branchId: string | null;
  branchName: string | null;
  checkpointId: string | null;
  manifest: {
    elements?: Element[];
    document?: { colorMode?: string };
    files?: unknown;
  } | null;
}

/** Each asset in the project with its active branch head and that checkpoint's manifest. */
export async function assetHeads(
  supabase: SupabaseClient,
  projectId: string,
): Promise<AssetHead[]> {
  const assets = unwrap(
    await supabase
      .from("assets")
      .select(
        "id,name,application,active_branch_id,branches!assets_active_branch_fk(name,head_checkpoint_id)",
      )
      .eq("project_id", projectId)
      .order("created_at"),
  ) as unknown as Array<{
    id: string;
    name: string;
    application: string;
    active_branch_id: string | null;
    branches: { name: string; head_checkpoint_id: string } | null;
  }>;
  const heads = assets
    .map((a) => a.branches?.head_checkpoint_id)
    .filter((id): id is string => !!id);
  const manifests = heads.length
    ? (unwrap(await supabase.from("checkpoints").select("id,manifest").in("id", heads)) as Array<{
        id: string;
        manifest: AssetHead["manifest"];
      }>)
    : [];
  return assets.map((a) => ({
    id: a.id,
    name: a.name,
    application: a.application,
    branchId: a.active_branch_id,
    branchName: a.branches?.name ?? null,
    checkpointId: a.branches?.head_checkpoint_id ?? null,
    manifest: manifests.find((m) => m.id === a.branches?.head_checkpoint_id)?.manifest ?? null,
  }));
}

export interface ElementRoleRow {
  asset_id: string;
  role: string;
  kind: string;
  native_ref: NativeRef;
}

export interface ThemeMappingRow {
  asset_id: string;
  color_role: ColorRole;
  element_role: string;
  property: "text.color" | "fill.color";
}

export type PlanStatus = "ready" | "no_changes" | "no_mappings" | "unsupported";

export interface AssetPlan {
  assetId: string;
  name: string;
  branchName: string | null;
  checkpointId: string | null;
  status: PlanStatus;
  reasons: string[];
  changes: Array<{ element: string; role: ColorRole; property: string; from?: string; to: string }>;
  /** Job parameters for a candidate when the asset can take the theme. */
  jobParams?: Record<string, unknown>;
}

/**
 * Checks each asset independently against its mappings, its branch head and its connector,
 * and builds the change set for the ones that can take the theme. Nothing runs here.
 */
export function planTheme(
  theme: { name: string; colors: ThemeColors },
  assets: AssetHead[],
  roles: ElementRoleRow[],
  mappings: ThemeMappingRow[],
  capabilities: Map<string, Capabilities>,
): AssetPlan[] {
  return assets.map((asset): AssetPlan => {
    const base = {
      assetId: asset.id,
      name: asset.name,
      branchName: asset.branchName,
      checkpointId: asset.checkpointId,
      changes: [] as AssetPlan["changes"],
    };
    const assetMappings = mappings.filter((m) => m.asset_id === asset.id);
    if (!assetMappings.length)
      return { ...base, status: "no_mappings", reasons: ["No layers are mapped to this theme"] };

    const reasons: string[] = [];
    const caps = capabilities.get(asset.application);
    if (!caps) reasons.push(`No ${asset.application} connector has reported what it can edit`);
    else if (!caps.operations.includes("createCandidate"))
      reasons.push(`The ${asset.application} connector can't build candidates`);
    if (!asset.checkpointId || !asset.manifest)
      reasons.push("Capture the document once so Sonder knows its layers");
    const colorMode = asset.manifest?.document?.colorMode;
    if (caps?.colorModes && colorMode && !caps.colorModes.includes(colorMode))
      reasons.push(
        `Color changes need ${caps.colorModes.join(" or ")}; this document is ${colorMode}`,
      );
    if (reasons.length) return { ...base, status: "unsupported", reasons };

    const elements = asset.manifest!.elements ?? [];
    const key = (native: NativeRef) => nativeIdentity(native, caps!.identityFields);
    const changeSet: ChangeSet = { mappings: [], changes: [] };
    const changes: AssetPlan["changes"] = [];
    for (const mapping of assetMappings) {
      const role = roles.find((r) => r.asset_id === asset.id && r.role === mapping.element_role);
      const element = role && elements.find((e) => key(e.native) === key(role.native_ref));
      if (!role || !element) {
        reasons.push(`The layer mapped as "${mapping.element_role}" is no longer in the document`);
        continue;
      }
      const editable = caps!.elementKinds.find((k) => k.kind === element.kind)?.properties ?? [];
      if (
        PROPERTY_FOR_KIND[element.kind] !== mapping.property ||
        !editable.includes(mapping.property)
      ) {
        reasons.push(`"${element.name}" can't take ${mapping.property}`);
        continue;
      }
      if (!element.editable) {
        reasons.push(`"${element.name}": ${element.notEditableReason ?? "not editable"}`);
        continue;
      }
      const to = theme.colors[mapping.color_role];
      const current = element.properties.find((p) => p.type === mapping.property);
      const next = { type: mapping.property, value: to } as PropertyValue;
      if (current && propertyValuesEqual(current, next)) continue;
      const elementId = randomUUID();
      changeSet.mappings.push({
        elementId,
        role: mapping.element_role,
        kind: element.kind,
        native: element.native,
      });
      changeSet.changes.push({ elementId, property: next });
      changes.push({
        element: element.name,
        role: mapping.color_role,
        property: mapping.property,
        ...(current ? { from: String(current.value) } : {}),
        to,
      });
    }
    if (reasons.length) return { ...base, status: "unsupported", reasons, changes };
    if (!changes.length)
      return { ...base, status: "no_changes", reasons: ["Already matches this theme"] };
    return {
      ...base,
      status: "ready",
      reasons: [],
      changes,
      jobParams: {
        message: `Apply theme "${theme.name}"`,
        targetCheckpoint: { id: asset.checkpointId, manifest: asset.manifest },
        changeSet,
      },
    };
  });
}

/** A plan as shown to users: without the job parameters (which carry whole manifests). */
export function publicPlan(plan: AssetPlan): Omit<AssetPlan, "jobParams"> {
  const copy = { ...plan };
  delete copy.jobParams;
  return copy;
}

/** Loads a theme with its mappings and everything needed to plan it. */
export async function loadThemeContext(
  supabase: SupabaseClient,
  projectId: string,
  themeId: string,
) {
  const theme = unwrap(
    await supabase
      .from("themes")
      .select("id,name,colors,created_at")
      .eq("id", themeId)
      .eq("project_id", projectId)
      .maybeSingle(),
  ) as { id: string; name: string; colors: ThemeColors; created_at: string } | null;
  if (!theme) throw new HttpError(404, "NOT_FOUND", "Theme not found");
  const assets = await assetHeads(supabase, projectId);
  const ids = assets.map((a) => a.id);
  const [roles, mappings, capabilities] = await Promise.all([
    ids.length
      ? supabase.from("asset_elements").select("asset_id,role,kind,native_ref").in("asset_id", ids)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("theme_mappings")
      .select("asset_id,color_role,element_role,property")
      .eq("theme_id", themeId),
    projectCapabilities(projectId),
  ]);
  return {
    theme,
    assets,
    roles: unwrap(roles) as ElementRoleRow[],
    mappings: unwrap(mappings) as ThemeMappingRow[],
    capabilities,
  };
}
