/**
 * Seeds a ready-to-combine demo document in an existing project, through the real Photoshop
 * plugin (which must be open and connected as a member of the project).
 *
 *   pnpm --filter web seed:combine-demo -- "<project name>"
 *
 * Creates "Combine Demo" (headline, body, solid background), captures it on main, then two
 * branches from that first version with captured edits:
 *   serif-headline   headline font → second installed font, headline color → gold
 *   red-background   background → deep red, headline color → light blue
 * Combining red-background into serif-headline then shows a clean change (background) and a
 * conflict (headline color) to resolve. Leaves serif-headline open in Photoshop.
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
const DEMO_NAME = "Combine Demo";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  {
    auth: { persistSession: false },
  },
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (text: string) => console.log(`• ${text}`);

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
  const projectName = process.argv.slice(2).find((a) => a !== "--") ?? "Test1";
  const { data: project } = await admin
    .from("projects")
    .select("id,name")
    .eq("name", projectName)
    .single();
  if (!project) throw new Error(`No project named ${projectName}`);

  const status = await trigger("status");
  const userId: string | undefined = status.connection?.user?.id;
  if (status.connection?.state !== "active" || !userId)
    throw new Error("Connect the Sonder panel first (Connect, then approve at /pair)");
  const { data: member } = await admin
    .from("project_members")
    .select("role")
    .eq("project_id", project.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member || member.role === "reviewer")
    throw new Error("The connected user must be an owner or editor of the project");

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

  async function switchTo(
    assetId: string,
    branch: { id: string; name: string; head_checkpoint_id: string },
  ) {
    const { data: a } = await admin
      .from("assets")
      .select("name,active_branch_id")
      .eq("id", assetId)
      .single();
    const { data: cps } = await admin
      .from("checkpoints")
      .select("id,manifest")
      .in("id", [branch.head_checkpoint_id]);
    const target = cps![0]!;
    await job(assetId, "openCheckpoint", {
      branchId: branch.id,
      branchName: branch.name,
      assetName: a!.name,
      checkpointId: target.id,
      native: target.manifest.files.native,
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
  }

  const fonts = (await trigger("fonts")) as [string, string];

  step("Creating the demo document in Photoshop");
  const doc = await trigger("open-fixture");
  const linked = await trigger("link", { projectId: project.id });
  const assetId = linked.id as string;
  await admin.from("assets").update({ name: DEMO_NAME }).eq("id", assetId);
  await sleep(4000); // let a heartbeat map the document

  step("Capturing the first version on main");
  const first = await capture(assetId, "First version");

  const branch = async (name: string) => {
    const { data, error } = await admin
      .from("branches")
      .insert({ asset_id: assetId, name, head_checkpoint_id: first, created_by: userId })
      .select("id,name,head_checkpoint_id")
      .single();
    if (error) throw new Error(`branch ${name}: ${error.message}`);
    return data!;
  };

  step(`Branch serif-headline: headline font ${fonts[1]}, headline color gold`);
  const serif = await branch("serif-headline");
  await switchTo(assetId, serif);
  await trigger("set-property", {
    layer: "Headline",
    property: { type: "text.font", value: { postScriptName: fonts[1] } },
  });
  await trigger("set-property", {
    layer: "Headline",
    property: { type: "text.color", value: "#FFD700" },
  });
  await trigger("save-active");
  await capture(assetId, `Serif headline (${fonts[1]}), gold`);

  step("Branch red-background: background deep red, headline color light blue");
  const red = await branch("red-background");
  await switchTo(assetId, red);
  await trigger("set-property", {
    layer: "Background Color",
    property: { type: "fill.color", value: "#8B1E3F" },
  });
  await trigger("set-property", {
    layer: "Headline",
    property: { type: "text.color", value: "#9AD1FF" },
  });
  await trigger("save-active");
  await capture(assetId, "Red background, light blue headline");

  step("Opening serif-headline again");
  const { data: serifNow } = await admin
    .from("branches")
    .select("id,name,head_checkpoint_id")
    .eq("id", serif.id)
    .single();
  await switchTo(assetId, serifNow!);
  // The original fixture file was closed by the first switch; nothing else to tidy.
  void doc;

  console.log(`\nDone. In ${project.name}, click the "${DEMO_NAME}" card → Combine branches…`);
  console.log("  Into: serif-headline   From: red-background");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
