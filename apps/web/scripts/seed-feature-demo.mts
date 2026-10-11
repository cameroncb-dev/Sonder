/**
 * Seeds a project for demoing every version feature, through the real Photoshop plugin (which
 * must be open and connected; the connected user becomes the project's owner).
 *
 *   pnpm --filter web seed:feature-demo -- "<project name>"     (default "Sonder Demo")
 *
 * Builds two documents:
 *
 *   Spring Poster
 *     main          v1 First draft ─ v2 Real copy ─ v3 Bigger headline ─ v4 Lime background (oops)
 *                                     ├─ warm-launch     Warm orange ─ Softer body text
 *                                     │    └─ warm-serif  Serif headline (from warm-launch)
 *                                     └─ night-edition   Midnight blue, cyan serif headline
 *   Spring Flyer
 *     main          v1 First draft ─ v2 Real copy
 *
 * plus two themes ("Sunset", "Midnight") already mapped to both documents' layers, two
 * directions pinning exact versions, and canvas notes walking through the demo: capture,
 * compare, restore (branch from v3), switch, combine, apply a theme and open a direction.
 * Leaves both documents open in Photoshop on main.
 */
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

const PLUGIN_DATA = join(
  homedir(),
  "Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/Developer/com.sonder.photoshop/PluginData",
);

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (text: string) => console.log(`• ${text}`);

interface Branch {
  id: string;
  name: string;
  head_checkpoint_id: string;
}

async function trigger(action: string, args: Record<string, unknown> = {}) {
  const runId = `seed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await writeFile(
    join(PLUGIN_DATA, "dev/trigger.json"),
    JSON.stringify({ runId, action, ...args }),
  );
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    try {
      const result = JSON.parse(
        await readFile(join(PLUGIN_DATA, `dev/result-${runId}.json`), "utf8"),
      );
      if (!result.ok) throw new Error(`Plugin action ${action} failed: ${result.error}`);
      return result.result;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Plugin action")) throw e;
    }
  }
  throw new Error(`Plugin did not answer ${action}; is the Sonder panel open?`);
}

async function main() {
  const projectName = process.argv.slice(2).find((a) => a !== "--") ?? "Sonder Demo";

  const status = await trigger("status");
  const userId: string | undefined = status.connection?.user?.id;
  if (status.connection?.state !== "active" || !userId)
    throw new Error("Connect the Sonder panel first (Connect, then approve at /pair)");

  const { data: existing } = await admin
    .from("projects")
    .select("id")
    .eq("name", projectName)
    .eq("created_by", userId)
    .maybeSingle();
  if (existing)
    throw new Error(`You already have a project named "${projectName}"; pass another name`);

  step(`Creating project "${projectName}"`);
  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({ name: projectName, created_by: userId })
    .select("id,name")
    .single();
  if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
  const { error: memberError } = await admin
    .from("project_members")
    .insert({ project_id: project.id, user_id: userId, role: "owner" });
  if (memberError) throw new Error(`member: ${memberError.message}`);

  /** Queues a job as the connected user and waits for the plugin to finish it. */
  async function job(assetId: string, operation: string, params: Record<string, unknown>) {
    const { data, error } = await admin
      .from("jobs")
      .insert({
        project_id: project!.id,
        asset_id: assetId,
        application: "photoshop",
        operation,
        operation_id: `seed-${randomUUID()}`,
        params,
        requires_asset_session: operation === "captureCheckpoint",
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`${operation}: ${error.message}`);
    for (let i = 0; i < 180; i++) {
      await sleep(1000);
      const { data: j } = await admin
        .from("jobs")
        .select("status,result,error")
        .eq("id", data!.id)
        .single();
      if (j!.status === "succeeded") return j!.result as Record<string, unknown>;
      if (j!.status === "failed")
        throw new Error(`${operation} failed: ${JSON.stringify(j!.error)}`);
    }
    throw new Error(`${operation} timed out; is the Sonder panel connected?`);
  }

  async function capture(assetId: string, message: string) {
    const { data: a } = await admin
      .from("assets")
      .select("active_branch_id")
      .eq("id", assetId)
      .single();
    const result = await job(assetId, "captureCheckpoint", {
      message,
      ...(a!.active_branch_id ? { branchId: a!.active_branch_id } : {}),
    });
    return result.checkpointId as string;
  }

  async function branchNamed(assetId: string, name: string) {
    const { data } = await admin
      .from("branches")
      .select("id,name,head_checkpoint_id")
      .eq("asset_id", assetId)
      .eq("name", name)
      .single();
    return data as Branch;
  }

  async function switchTo(assetId: string, branch: Branch) {
    const { data: a } = await admin.from("assets").select("name").eq("id", assetId).single();
    const { data: target } = await admin
      .from("checkpoints")
      .select("id,manifest")
      .eq("id", branch.head_checkpoint_id)
      .single();
    await job(assetId, "openCheckpoint", {
      branchId: branch.id,
      branchName: branch.name,
      assetName: a!.name,
      checkpointId: target!.id,
      native: target!.manifest.files.native,
      currentHeadElements: null,
      force: false,
    });
    // Wait until the panel maps the new working copy, so captures find it.
    for (let i = 0; i < 30; i++) {
      const s = await trigger("status");
      if (
        s.assets.some(
          (x: { assetId: string; branchName?: string }) =>
            x.assetId === assetId && x.branchName === branch.name,
        )
      )
        return;
      await sleep(1000);
    }
    throw new Error(`Photoshop did not open ${branch.name}`);
  }

  /** Applies edits to the open document, saves it and captures one version. */
  async function edit(
    assetId: string,
    message: string,
    changes: Array<[layer: string, type: string, value: unknown]>,
  ) {
    for (const [layer, type, value] of changes)
      await trigger("set-property", { layer, property: { type, value } });
    await trigger("save-active");
    return capture(assetId, message);
  }

  async function branchFrom(assetId: string, name: string, checkpointId: string) {
    const { data, error } = await admin
      .from("branches")
      .insert({ asset_id: assetId, name, head_checkpoint_id: checkpointId, created_by: userId })
      .select("id,name,head_checkpoint_id")
      .single();
    if (error) throw new Error(`branch ${name}: ${error.message}`);
    return data as Branch;
  }

  /** Creates a fixture PSD in Photoshop, links it to the project and names it. */
  async function newDocument(name: string) {
    await trigger("open-fixture");
    const linked = await trigger("link", { projectId: project!.id });
    const assetId = linked.id as string;
    await admin.from("assets").update({ name }).eq("id", assetId);
    await sleep(4000); // let a heartbeat map the document
    return assetId;
  }

  const fonts = (await trigger("fonts")) as [string, string];
  const serif = { postScriptName: fonts[1] };

  // --- Spring Poster: history with branches, a mistake to restore from, a combine to try ---
  step("Spring Poster: creating it in Photoshop");
  const poster = await newDocument("Spring Poster");
  step("Spring Poster main: v1 First draft");
  await capture(poster, "First draft");
  step("Spring Poster main: v2 Real copy");
  const v2 = await edit(poster, "Real copy", [
    ["Headline", "text.content", "Spring Jazz Night"],
    ["Body", "text.content", "Friday · 8 pm · The Blue Room"],
  ]);
  step("Spring Poster main: v3 Bigger headline");
  await edit(poster, "Bigger headline", [["Headline", "text.size", 80]]);
  step("Spring Poster main: v4 Lime background (the mistake to restore from)");
  await edit(poster, "Lime background (oops)", [
    ["Background Color", "fill.color", "#A3E635"],
    ["Headline", "text.color", "#4D7C0F"],
  ]);

  step("Spring Poster warm-launch (from v2): warm orange, then softer body text");
  const warm = await branchFrom(poster, "warm-launch", v2);
  await switchTo(poster, warm);
  await edit(poster, "Warm orange background", [
    ["Background Color", "fill.color", "#E4572E"],
    ["Headline", "text.color", "#FFF4D6"],
  ]);
  const warmHead = await edit(poster, "Softer body text", [["Body", "text.color", "#FFD8A8"]]);

  step("Spring Poster warm-serif (from warm-launch): serif headline");
  const warmSerif = await branchFrom(poster, "warm-serif", warmHead);
  await switchTo(poster, warmSerif);
  const warmSerifHead = await edit(poster, `Serif headline (${fonts[1]})`, [
    ["Headline", "text.font", serif],
  ]);

  step("Spring Poster night-edition (from v2): midnight blue, cyan serif headline");
  const night = await branchFrom(poster, "night-edition", v2);
  await switchTo(poster, night);
  const nightHead = await edit(poster, "Midnight blue, cyan serif headline", [
    ["Background Color", "fill.color", "#0B1A3A"],
    ["Headline", "text.color", "#22D3EE"],
    ["Headline", "text.font", serif],
  ]);

  step("Spring Poster: back to main");
  await switchTo(poster, await branchNamed(poster, "main"));

  // --- Spring Flyer: a second document, so themes and directions span documents ---
  step("Spring Flyer: creating it in Photoshop");
  const flyer = await newDocument("Spring Flyer");
  step("Spring Flyer main: v1 First draft");
  const flyerV1 = await capture(flyer, "First draft");
  step("Spring Flyer main: v2 Real copy");
  const flyerV2 = await edit(flyer, "Real copy", [
    ["Headline", "text.content", "Jazz Night"],
    ["Body", "text.content", "This Friday at The Blue Room"],
  ]);

  // --- Themes, mapped to the same layers in both documents ---
  step("Adding themes Sunset and Midnight, mapped to both documents");
  const themeColors = {
    Sunset: { primary: "#FFF4D6", background: "#E4572E", text: "#FFD8A8", accent: "#FFB703" },
    Midnight: { primary: "#22D3EE", background: "#0B1A3A", text: "#CBD5E1", accent: "#A78BFA" },
  };
  const layerRoles: Array<[layer: string, colorRole: string]> = [
    ["Headline", "primary"],
    ["Body", "text"],
    ["Background Color", "background"],
  ];
  const themeIds: string[] = [];
  for (const [name, colors] of Object.entries(themeColors)) {
    const { data, error } = await admin
      .from("themes")
      .insert({ project_id: project.id, name, colors, created_by: userId })
      .select("id")
      .single();
    if (error) throw new Error(`theme ${name}: ${error.message}`);
    themeIds.push(data.id);
  }
  for (const [assetId, head] of [
    [poster, (await branchNamed(poster, "main")).head_checkpoint_id],
    [flyer, flyerV2],
  ]) {
    const { data: cp } = await admin.from("checkpoints").select("manifest").eq("id", head).single();
    const elements = cp!.manifest.elements as Array<{
      name: string;
      kind: string;
      native: unknown;
    }>;
    const mappings: Array<{ color_role: string; element_role: string; property: string }> = [];
    for (const [layer, colorRole] of layerRoles) {
      const element = elements.find((e) => e.name === layer);
      if (!element) throw new Error(`No ${layer} layer in ${assetId}`);
      const role = layer.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const { error } = await admin
        .from("asset_elements")
        .insert({ asset_id: assetId, role, kind: element.kind, native_ref: element.native });
      if (error) throw new Error(`element ${layer}: ${error.message}`);
      mappings.push({
        color_role: colorRole,
        element_role: role,
        property: element.kind === "text" ? "text.color" : "fill.color",
      });
    }
    const { error } = await admin
      .from("theme_mappings")
      .insert(
        themeIds.flatMap((theme_id) =>
          mappings.map((m) => ({ ...m, theme_id, asset_id: assetId })),
        ),
      );
    if (error) throw new Error(`mappings: ${error.message}`);
  }

  // --- Directions pinning exact versions across both documents ---
  step("Adding directions Client shortlist and Night launch");
  const directions: Array<[string, string, Array<[string, string]>]> = [
    [
      "Client shortlist",
      "Warm serif poster with the final flyer copy",
      [
        [poster, warmSerifHead],
        [flyer, flyerV2],
      ],
    ],
    [
      "Night launch",
      "Night edition poster with the first flyer draft",
      [
        [poster, nightHead],
        [flyer, flyerV1],
      ],
    ],
  ];
  const directionIds: string[] = [];
  for (const [name, description, entries] of directions) {
    const { data, error } = await admin
      .from("directions")
      .insert({ project_id: project.id, name, description, created_by: userId })
      .select("id")
      .single();
    if (error) throw new Error(`direction ${name}: ${error.message}`);
    const { error: entryError } = await admin.from("direction_entries").insert(
      entries.map(([asset_id, checkpoint_id]) => ({
        direction_id: data.id,
        asset_id,
        checkpoint_id,
      })),
    );
    if (entryError) throw new Error(`direction ${name}: ${entryError.message}`);
    directionIds.push(data.id);
  }

  // --- Canvas: documents in a column, themes and directions beside them, a guided path ---
  step("Laying out the canvas");
  // The canvas creates document cards on first load, to the right of everything else; place
  // them first so the rest sits beside them.
  const { error: cardError } = await admin.from("canvas_items").upsert(
    [
      { project_id: project.id, item_type: "asset", ref_id: poster, x: 0, y: 0 },
      { project_id: project.id, item_type: "asset", ref_id: flyer, x: 0, y: 420 },
    ],
    { onConflict: "project_id,ref_id", ignoreDuplicates: true },
  );
  if (cardError) throw new Error(`cards: ${cardError.message}`);
  const notes: Array<[string, string]> = [
    ["1 · Capture: edit the Poster in Photoshop, save, then Capture in the inspector.", "yellow"],
    ["2 · Compare: tick v2 and v3 in History and click Compare.", "pink"],
    [
      "3 · Restore: v4 has a lime mistake. Click v3, Branch from here as restore-v3, Switch.",
      "orange",
    ],
    ["4 · Switch: open night-edition from Branches; Photoshop opens that version.", "blue"],
    [
      "5 · Combine: night-edition into warm-launch. Resolve the conflicts, build, approve.",
      "green",
    ],
    ["6 · Themes: open Sunset, include both documents, Apply, review, approve.", "purple"],
    ["7 · Directions: open Client shortlist to reopen its exact versions.", "grey"],
  ];
  const { error: canvasError } = await admin.from("canvas_items").insert([
    {
      project_id: project.id,
      item_type: "text",
      x: 0,
      y: -110,
      content: {
        text: "Sonder demo: capture, branch, restore, combine, themes, directions",
        size: "large",
        color: "default",
        font: "System UI",
      },
      updated_by: userId,
    },
    ...themeIds.map((ref_id, i) => ({
      project_id: project.id,
      item_type: "theme",
      ref_id,
      content: {},
      x: 320,
      y: i * 200,
      updated_by: userId,
    })),
    ...directionIds.map((ref_id, i) => ({
      project_id: project.id,
      item_type: "direction",
      ref_id,
      content: {},
      x: 320,
      y: 420 + i * 220,
      updated_by: userId,
    })),
    ...notes.map(([text, color], i) => ({
      project_id: project.id,
      item_type: "note",
      x: 640 + (i % 2) * 260,
      y: Math.floor(i / 2) * 240,
      content: { text, color, shape: "rounded", font: "System UI" },
      updated_by: userId,
    })),
  ]);
  if (canvasError) throw new Error(`canvas: ${canvasError.message}`);

  console.log(`\nDone. Open "${project.name}" from Projects.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
