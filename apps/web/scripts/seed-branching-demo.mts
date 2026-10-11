/**
 * Seeds a new project that shows off branching, through the real Photoshop plugin (which must
 * be open and connected; the connected user becomes the project's owner).
 *
 *   pnpm --filter web seed:branching-demo -- "<project name>"     (default "Branching Demo")
 *
 * Builds "Spring Poster" with this history:
 *
 *   main          v1 First draft ─ v2 Real copy ─ v3 Bigger headline
 *                                   ├─ warm-launch     Warm orange ─ Softer body text
 *                                   │    └─ warm-serif  Serif headline (from warm-launch)
 *                                   └─ night-edition   Midnight blue, cyan serif headline
 *
 * plus a title and notes on the canvas suggesting what to try. Leaves main open in Photoshop.
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
const DOC_NAME = "Spring Poster";

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
  const projectName = process.argv.slice(2).find((a) => a !== "--") ?? "Branching Demo";

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

  const fonts = (await trigger("fonts")) as [string, string];
  const serif = { postScriptName: fonts[1] };

  step("Creating the poster in Photoshop");
  await trigger("open-fixture");
  const linked = await trigger("link", { projectId: project.id });
  const assetId = linked.id as string;
  await admin.from("assets").update({ name: DOC_NAME }).eq("id", assetId);
  await sleep(4000); // let a heartbeat map the document

  step("main: v1 First draft");
  await capture(assetId, "First draft");
  step("main: v2 Real copy");
  const v2 = await edit(assetId, "Real copy", [
    ["Headline", "text.content", "Spring Jazz Night"],
    ["Body", "text.content", "Friday · 8 pm · The Blue Room"],
  ]);
  step("main: v3 Bigger headline");
  await edit(assetId, "Bigger headline", [["Headline", "text.size", 80]]);
  const { data: mainBranch } = await admin
    .from("branches")
    .select("id,name,head_checkpoint_id")
    .eq("asset_id", assetId)
    .eq("name", "main")
    .single();

  step("warm-launch (from v2): warm orange, then softer body text");
  const warm = await branchFrom(assetId, "warm-launch", v2);
  await switchTo(assetId, warm);
  await edit(assetId, "Warm orange background", [
    ["Background Color", "fill.color", "#E4572E"],
    ["Headline", "text.color", "#FFF4D6"],
  ]);
  const warmHead = await edit(assetId, "Softer body text", [["Body", "text.color", "#FFD8A8"]]);

  step("warm-serif (from warm-launch): serif headline");
  const warmSerif = await branchFrom(assetId, "warm-serif", warmHead);
  await switchTo(assetId, warmSerif);
  await edit(assetId, `Serif headline (${fonts[1]})`, [["Headline", "text.font", serif]]);

  step("night-edition (from v2): midnight blue, cyan serif headline");
  const night = await branchFrom(assetId, "night-edition", v2);
  await switchTo(assetId, night);
  await edit(assetId, "Midnight blue, cyan serif headline", [
    ["Background Color", "fill.color", "#0B1A3A"],
    ["Headline", "text.color", "#22D3EE"],
    ["Headline", "text.font", serif],
  ]);

  step("Back to main");
  const { data: mainNow } = await admin
    .from("branches")
    .select("id,name,head_checkpoint_id")
    .eq("id", mainBranch!.id)
    .single();
  await switchTo(assetId, mainNow as Branch);

  step("Adding a title and notes to the canvas");
  // The canvas creates document cards on first load, to the right of everything else; place
  // this one first so the notes sit beside it.
  const at = { x: 0, y: 0 };
  const { error: cardError } = await admin
    .from("canvas_items")
    .upsert(
      { project_id: project.id, item_type: "asset", ref_id: assetId, ...at },
      { onConflict: "project_id,ref_id", ignoreDuplicates: true },
    );
  if (cardError) throw new Error(`card: ${cardError.message}`);
  const notes: Array<[string, string, string]> = [
    [
      "Click the Spring Poster card: the history shows main and three branches.",
      "yellow",
      "square",
    ],
    ["Pick two versions in the history and Compare them side by side.", "pink", "rounded"],
    ["Switch to night-edition from Branches: Photoshop opens that version.", "blue", "rounded"],
    ["Try Combine branches: night-edition into warm-launch.", "green", "square"],
  ];
  const { error: canvasError } = await admin.from("canvas_items").insert([
    {
      project_id: project.id,
      item_type: "text",
      x: at.x,
      y: at.y - 110,
      content: {
        text: "Spring Poster: branching demo",
        size: "large",
        color: "default",
        font: "System UI",
      },
      updated_by: userId,
    },
    ...notes.map(([text, color, shape], i) => ({
      project_id: project.id,
      item_type: "note",
      x: at.x + 320 + (i % 2) * 260,
      y: at.y + Math.floor(i / 2) * 240,
      content: { text, color, shape, font: "System UI" },
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
