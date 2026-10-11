/**
 * End-to-end check of Phase 3 with the real Photoshop plugin.
 *
 *   pnpm --filter web e2e:connector
 *
 * Requires: `pnpm dev` on :3000, Photoshop with the Sonder panel open (Load &
 * Watch), and Supabase keys in apps/web/.env.local. The script plays the web
 * user through the real API routes; the plugin does the connector work. It
 * creates throwaway users, a project and files, and deletes them at the end.
 */
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BASE = "http://localhost:3000";

/** Same FNV-1a 64 as @sonder/connector-sdk (Node can't import the TS package directly). */
function fnv1a64(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16).padStart(16, "0");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
if (!url || !publishableKey || !secretKey) throw new Error("Supabase env missing");

const DATA = path.join(
  homedir(),
  "Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/Developer/com.sonder.photoshop/PluginData",
);
const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  const suffix =
    detail === undefined ? "" : `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${suffix}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined | null | false>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** A signed-in browser-like user: cookies for API routes plus a client for storage. */
async function signedInUser(label: string) {
  const email = `sonder-e2e-${label}-${randomUUID()}@example.com`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const jar = new Map<string, string>();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) =>
        cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  }) as unknown as SupabaseClient;
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const cookie = () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const api = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(`${BASE}${route}`, {
      method,
      headers: { cookie: cookie(), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      // Test script: responses are inspected loosely and asserted field by field.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: (await response.json().catch(() => ({}))) as Record<string, any>,
    };
  };
  return { id: data.user.id, email, client, api };
}

async function trigger(action: string, extra: Record<string, unknown> = {}) {
  const runId = `e2e${Date.now()}`;
  await writeFile(path.join(DATA, "dev/trigger.json"), JSON.stringify({ runId, action, ...extra }));
  const result = await waitFor(`plugin action ${action}`, async () => {
    try {
      return JSON.parse(await readFile(path.join(DATA, `dev/result-${runId}.json`), "utf8"));
    } catch {
      return undefined;
    }
  });
  if (!result.ok) throw new Error(`Plugin action ${action} failed: ${result.error}`);
  return result.result;
}

async function pluginStatus() {
  return JSON.parse(await readFile(path.join(DATA, "connector/status.json"), "utf8"));
}

async function waitJob(
  api: Awaited<ReturnType<typeof signedInUser>>["api"],
  jobId: string,
  status: string,
  timeoutMs = 90_000,
) {
  return waitFor(
    `job ${jobId} ${status}`,
    async () => {
      const r = await api("GET", `/api/jobs/${jobId}`);
      return r.body.job?.status === status ? r.body : undefined;
    },
    timeoutMs,
  );
}

async function removeProjectFiles(projectId: string) {
  for (const bucket of ["snapshots", "previews", "references"]) {
    const { data: assets } = await admin.storage.from(bucket).list(projectId);
    for (const asset of assets ?? []) {
      const { data: checkpoints } = await admin.storage
        .from(bucket)
        .list(`${projectId}/${asset.name}`);
      for (const cp of checkpoints ?? []) {
        const prefix = `${projectId}/${asset.name}/${cp.name}`;
        const { data: files } = await admin.storage.from(bucket).list(prefix);
        if (files?.length)
          await admin.storage.from(bucket).remove(files.map((f) => `${prefix}/${f.name}`));
      }
    }
  }
}

async function main() {
  const owner = await signedInUser("owner");
  const outsider = await signedInUser("outsider");
  let projectId: string | undefined;
  const ownDocuments: string[] = [];
  const extraUsers: string[] = [];
  try {
    const created = await owner.api("POST", "/api/projects", { name: "E2E posters" });
    projectId = created.body.project?.id;
    check(
      "owner creates a project through the API",
      created.status === 201 && !!projectId,
      created.status,
    );

    const doc = await trigger("open-fixture");
    // Close only this run's documents afterwards; other working copies may hold someone's work.
    if (typeof doc.path === "string") ownDocuments.push(doc.path.replace(/[^/]+$/, ""));
    check("Photoshop opens a saved test document", typeof doc.path === "string", doc.path);

    // Keep the panel's own connection safe while the test pairs as a test user.
    await trigger("stash-session");
    await trigger("pair");
    const pairing = await pluginStatus();
    const code = pairing.connection.code as string;
    check(
      "plugin requests pairing and shows a code",
      pairing.connection.state === "pairing" && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code),
      code,
    );

    const wrong = await outsider.api("POST", "/api/connector/pair/approve", { code: "AAAA-2222" });
    check("unknown pairing code is rejected", wrong.status === 404, wrong.status);
    const approved = await owner.api("POST", "/api/connector/pair/approve", { code });
    check("signed-in user approves the code", approved.status === 200, approved.body);
    const active = await waitFor("plugin active", async () => {
      const s = await pluginStatus();
      return s.connection.state === "active" ? s : undefined;
    });
    check(
      "plugin receives an expiring token for that user",
      active.connection.user.email === owner.email,
      active.connection.expiresAt,
    );

    const { data: session } = await admin
      .from("connector_sessions")
      .select("id,status,expires_at,pairing_code,pairing_secret_hash,user_id")
      .eq("user_id", owner.id)
      .single();
    check(
      "session is active, bound to the user, pairing secrets cleared",
      session?.status === "active" && !session.pairing_code && !session.pairing_secret_hash,
      session?.status,
    );

    const asset = await trigger("link", { projectId });
    ownDocuments.push(`/working/${asset.id}/`);
    check("plugin links the open document as a project asset", !!asset.id, asset.name);
    await waitFor("heartbeat reports the asset", async () =>
      (await pluginStatus()).assets.some((a: { assetId: string }) => a.assetId === asset.id),
    );
    check("heartbeat maps the open document to the asset", true);

    // --- Capture through a job ---
    const op1 = `e2e-${randomUUID()}`;
    const job1 = await owner.api("POST", `/api/projects/${projectId}/assets/${asset.id}/capture`, {
      operationId: op1,
      message: "Original",
    });
    check("owner queues a capture job", job1.status === 201, job1.body.job?.status);
    const done1 = await waitJob(owner.api, job1.body.job.id, "succeeded");
    check(
      "plugin claims, captures, uploads and finalizes",
      !!done1.job.result?.checkpointId,
      done1.events
        .map((e: { from_status: string; to_status: string }) => `${e.from_status}->${e.to_status}`)
        .join(" "),
    );

    const list1 = await owner.api(
      "GET",
      `/api/projects/${projectId}/checkpoints?assetId=${asset.id}`,
    );
    const cp1 = list1.body.checkpoints?.[0];
    check(
      "checkpoint is listed with a signed preview URL",
      list1.body.checkpoints?.length === 1 && !!cp1?.previewUrl,
    );
    const { data: cpRow } = await owner.client
      .from("checkpoints")
      .select("manifest,native_path,preview_path")
      .eq("id", cp1.id)
      .single();
    const { data: nativeBlob } = await owner.client.storage
      .from("snapshots")
      .download(cpRow!.native_path);
    const nativeBytes = new Uint8Array(await nativeBlob!.arrayBuffer());
    check(
      "stored snapshot matches the manifest digest",
      fnv1a64(nativeBytes) === cpRow!.manifest.files.native.digest &&
        nativeBytes.length === cpRow!.manifest.files.native.bytes,
      `${nativeBytes.length} bytes`,
    );
    const preview = await fetch(cp1.previewUrl);
    const previewBytes = new Uint8Array(await preview.arrayBuffer());
    check(
      "preview downloads via signed URL and matches",
      fnv1a64(previewBytes) === cpRow!.manifest.files.preview.digest,
    );
    check(
      "manifest records the Photoshop elements",
      cpRow!.manifest.elements.length === 3,
      cpRow!.manifest.applicationVersion,
    );

    const again = await owner.api("POST", `/api/projects/${projectId}/assets/${asset.id}/capture`, {
      operationId: op1,
    });
    const { count: c1 } = await admin
      .from("checkpoints")
      .select("id", { count: "exact", head: true })
      .eq("operation_id", op1);
    check(
      "resubmitting an operation id returns the same job, no new checkpoint",
      again.body.job?.id === job1.body.job.id && again.body.job?.status === "succeeded" && c1 === 1,
    );

    // --- Interrupted delivery: lease expires after uploads, before finalize ---
    await trigger("fault", { stage: "before-finalize" });
    const op2 = `e2e-${randomUUID()}`;
    const job2 = await owner.api("POST", `/api/projects/${projectId}/assets/${asset.id}/capture`, {
      operationId: op2,
      message: "Second on main",
    });
    await waitFor("plugin pauses before finalize", async () =>
      (await pluginStatus()).lastJob?.outcome?.includes("paused") ? true : undefined,
    );
    const { data: pending } = await admin
      .from("checkpoints")
      .select("id,status")
      .eq("operation_id", op2)
      .single();
    const hidden = await owner.api(
      "GET",
      `/api/projects/${projectId}/checkpoints?assetId=${asset.id}`,
    );
    check(
      "interrupted checkpoint stays pending and unlisted",
      pending?.status === "pending" && hidden.body.checkpoints.length === 1,
    );

    await admin
      .from("jobs")
      .update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", job2.body.job.id);
    const done2 = await waitJob(owner.api, job2.body.job.id, "succeeded");
    const { count: c2 } = await admin
      .from("checkpoints")
      .select("id", { count: "exact", head: true })
      .eq("operation_id", op2);
    const outcome = (await pluginStatus()).lastJob?.outcome as string;
    const transitions = done2.events.map((e: { to_status: string }) => e.to_status).join(" ");
    check(
      "expired lease is reconciled and retried (attempt 2)",
      done2.job.attempts === 2 && transitions === "queued leased queued leased succeeded",
      transitions,
    );
    check(
      "retry reuses the first capture and uploads nothing twice",
      outcome.includes("reused capture") && outcome.includes("uploaded 0"),
      outcome,
    );
    check(
      "repeated delivery produced exactly one checkpoint",
      c2 === 1 && done2.job.result?.checkpointId === pending?.id,
    );

    // --- Phase 4: branches, checkout, history and canvas ---
    const historyUrl = `/api/projects/${projectId}/assets/${asset.id}/history`;
    const h1 = (await owner.api("GET", historyUrl)).body;
    const main = h1.branches.find((b: { name: string }) => b.name === "main");
    check(
      "first capture created and activated main; second capture advanced it",
      main?.head_checkpoint_id === pending?.id && h1.asset.activeBranchId === main?.id,
    );
    const cp2 = h1.checkpoints.find((c: { id: string }) => c.id === pending?.id);
    check("second checkpoint's parent is the first", cp2?.parents?.[0] === cp1.id, cp2?.parents);

    const alt = await owner.api("POST", `/api/projects/${projectId}/assets/${asset.id}/branches`, {
      name: "alt",
      checkpointId: cp1.id,
    });
    check(
      "owner creates a branch from the first checkpoint",
      alt.status === 201,
      alt.body.branch?.name,
    );

    const checkoutJob = async (force = false) => {
      const r = await owner.api("POST", `/api/projects/${projectId}/assets/${asset.id}/checkout`, {
        branchId: alt.body.branch.id,
        force,
      });
      return waitFor("checkout to finish", async () => {
        const j = await owner.api("GET", `/api/jobs/${r.body.job.id}`);
        return ["succeeded", "failed"].includes(j.body.job?.status) ? j.body.job : undefined;
      });
    };

    /** Waits until the canvas reports the given document state for the asset. */
    const documentState = (unsaved: boolean, uncaptured: boolean | null) =>
      waitFor(
        `document state unsaved=${unsaved} uncaptured=${uncaptured}`,
        async () => {
          const c = (await owner.api("GET", `/api/projects/${projectId}/canvas`)).body;
          const status = c.assets.find((a: { id: string }) => a.id === asset.id)?.connector;
          return status?.unsaved === unsaved && status?.uncaptured === uncaptured;
        },
        30_000,
      ).then(
        () => true,
        () => false,
      );
    check("canvas reports the captured document as up to date", await documentState(false, false));

    await trigger("edit-text", { text: "Unsaved edit" });
    check("canvas reports unsaved changes after an edit", await documentState(true, null));
    const unsaved = await checkoutJob();
    check(
      "checkout refuses a document with unsaved changes",
      unsaved.status === "failed" && unsaved.error?.code === "UNSAVED_CHANGES",
      unsaved.error?.message,
    );
    await trigger("save-active");
    check("canvas reports uncaptured changes after saving", await documentState(false, true));
    const uncaptured = await checkoutJob();
    check(
      "checkout refuses saved but uncaptured changes",
      uncaptured.status === "failed" && uncaptured.error?.code === "UNCAPTURED_CHANGES",
      uncaptured.error?.message,
    );
    const stillMain = (await owner.api("GET", historyUrl)).body.asset.activeBranchId;
    check("failed checkouts leave main active", stillMain === main?.id);

    const forced = await checkoutJob(true);
    const h2 = (await owner.api("GET", historyUrl)).body;
    check(
      "forced checkout opens alt as a working copy and makes it active",
      forced.status === "succeeded" &&
        h2.asset.activeBranchId === alt.body.branch.id &&
        h2.asset.path === forced.result?.path &&
        h2.asset.path !== doc.path,
      h2.asset.path,
    );
    await waitFor("heartbeat maps the working copy", async () =>
      (await pluginStatus()).assets.some((a: { path: string }) => a.path === forced.result?.path),
    );
    check(
      "the working copy is named after the document and branch",
      typeof forced.result?.path === "string" && forced.result.path.endsWith("/fixture - alt.psd"),
      forced.result?.path,
    );

    // Reopening the original file (as a user might) must not look like a new document.
    const fixtureFolder = (doc.path as string).split("/").slice(-2, -1)[0];
    await trigger("reopen-fixture", { folder: fixtureFolder });
    const formerSeen = await waitFor("panel recognises the original file", async () =>
      (await pluginStatus()).former?.find(
        (f: { path: string; currentPath: string }) =>
          f.path === doc.path && f.currentPath === forced.result?.path,
      ),
    ).catch(() => undefined);
    const relink = await trigger("link", { projectId }).then(
      () => "linked",
      (e: Error) => e.message,
    );
    const { count: assetCount } = await admin
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    check(
      "the original file is recognised as an earlier file and can't be linked again",
      !!formerSeen && relink.includes("earlier version") && assetCount === 1,
      relink,
    );
    await trigger("close-docs", { match: `${fixtureFolder}/fixture.psd` });

    const op3 = `e2e-${randomUUID()}`;
    const job3 = await owner.api("POST", `/api/projects/${projectId}/assets/${asset.id}/capture`, {
      operationId: op3,
      message: "First on alt",
    });
    const done3 = await waitJob(owner.api, job3.body.job.id, "succeeded");
    const h3 = (await owner.api("GET", historyUrl)).body;
    const cp3 = h3.checkpoints.find((c: { id: string }) => c.id === done3.job.result?.checkpointId);
    const heads = Object.fromEntries(
      h3.branches.map((b: { name: string; head_checkpoint_id: string }) => [
        b.name,
        b.head_checkpoint_id,
      ]),
    );
    check(
      "capture on alt descends from the first checkpoint; main is untouched",
      cp3?.parents?.[0] === cp1.id && heads.alt === cp3?.id && heads.main === pending?.id,
      heads,
    );
    const { data: sources } = await admin
      .from("checkpoints")
      .select("id,native_digest,status")
      .in("id", [cp1.id, pending!.id]);
    check(
      "branching preserved both source checkpoints",
      sources?.length === 2 &&
        sources.every((s) => s.status === "finalized") &&
        sources.find((s) => s.id === cp1.id)?.native_digest === cpRow!.manifest.files.native.digest,
    );
    check(
      "history flags a capture with no text or color changes",
      h3.checkpoints.find((c: { id: string }) => c.id === pending?.id)?.noPropertyChanges === true,
    );
    check(
      "history shows three checkpoints with previews",
      h3.checkpoints.length === 3 &&
        h3.checkpoints.every((c: { previewUrl: string }) => !!c.previewUrl),
    );

    const canvas = (await owner.api("GET", `/api/projects/${projectId}/canvas`)).body;
    const card = canvas.items.find((i: { ref_id: string }) => i.ref_id === asset.id);
    const canvasAsset = canvas.assets.find((a: { id: string }) => a.id === asset.id);
    check("asset card is placed on the canvas automatically", !!card, { x: card?.x, y: card?.y });
    check(
      "canvas shows application, active branch, connector status and supported actions",
      canvasAsset?.application === "photoshop" &&
        canvasAsset?.activeBranch?.name === "alt" &&
        canvasAsset?.connector.online === true &&
        ["captureCheckpoint", "openCheckpoint"].every((op) =>
          canvasAsset.connector.capabilities?.operations.includes(op),
        ),
      canvasAsset?.connector.capabilities?.operations,
    );

    const note = await owner.api("POST", `/api/projects/${projectId}/canvas/items`, {
      itemType: "note",
      x: 10,
      y: 10,
      content: { text: "Try the alt headline font" },
    });
    const moved = await owner.api(
      "PATCH",
      `/api/projects/${projectId}/canvas/items/${note.body.item.id}`,
      {
        version: note.body.item.version,
        x: 640,
        y: 360,
      },
    );
    const stale = await owner.api(
      "PATCH",
      `/api/projects/${projectId}/canvas/items/${note.body.item.id}`,
      {
        version: note.body.item.version,
        x: 1,
        y: 1,
      },
    );
    check(
      "stale canvas save is rejected with the current version",
      moved.status === 200 && stale.status === 409 && stale.body.error?.details?.current?.x === 640,
    );
    const reloaded = (await owner.api("GET", `/api/projects/${projectId}/canvas`)).body;
    const persisted = reloaded.items.find((i: { id: string }) => i.id === note.body.item.id);
    check(
      "layout persists after reload",
      persisted?.x === 640 && persisted?.y === 360 && persisted?.version === 2,
    );

    // --- Phase 6 canvas additions: styled notes, free text, sections ---
    const itemsUrl = `/api/projects/${projectId}/canvas/items`;
    const styled = await owner.api("POST", itemsUrl, {
      itemType: "note",
      x: 900,
      y: 100,
      content: { text: "Diamond", shape: "diamond", color: "purple", font: "Playfair Display" },
    });
    const freeText = await owner.api("POST", itemsUrl, {
      itemType: "text",
      x: 900,
      y: 400,
      content: { text: "Launch ideas", font: "Bebas Neue", size: "heading", color: "blue" },
    });
    const section = await owner.api("POST", itemsUrl, {
      itemType: "section",
      x: 850,
      y: 50,
      content: { title: "Moodboard", color: "green" },
    });
    const badFont = await owner.api("POST", itemsUrl, {
      itemType: "text",
      x: 0,
      y: 0,
      content: { text: "x", font: "Not A Font" },
    });
    const badShape = await owner.api("PATCH", `${itemsUrl}/${styled.body.item?.id}`, {
      version: styled.body.item?.version,
      content: { text: "x", shape: "hexagon" },
    });
    const resized = await owner.api("PATCH", `${itemsUrl}/${section.body.item?.id}`, {
      version: section.body.item?.version,
      width: 900,
      height: 600,
    });
    const afterReload = (await owner.api("GET", `/api/projects/${projectId}/canvas`)).body;
    const byId = (id: string) => afterReload.items.find((i: { id: string }) => i.id === id);
    check(
      "styled notes, free text and sections save and reload with their style",
      styled.status === 201 &&
        freeText.status === 201 &&
        section.status === 201 &&
        byId(styled.body.item.id)?.content.shape === "diamond" &&
        byId(styled.body.item.id)?.content.font === "Playfair Display" &&
        byId(freeText.body.item.id)?.content.size === "heading" &&
        byId(section.body.item.id)?.content.title === "Moodboard",
      [styled.status, freeText.status, section.status],
    );
    check(
      "unknown fonts and shapes are refused; a resized section keeps its size",
      badFont.status === 400 &&
        badShape.status === 400 &&
        resized.status === 200 &&
        byId(section.body.item.id)?.width === 900 &&
        byId(section.body.item.id)?.height === 600,
      [badFont.status, badShape.status, resized.status],
    );

    const parentCount = async () =>
      (
        await admin
          .from("checkpoint_parents")
          .select("*", { count: "exact", head: true })
          .eq("asset_id", asset.id)
      ).count;
    const before = await parentCount();
    const link = await owner.api("POST", `/api/projects/${projectId}/canvas/connections`, {
      fromItemId: card.id,
      toItemId: note.body.item.id,
    });
    const movedAsset = await owner.api(
      "PATCH",
      `/api/projects/${projectId}/canvas/items/${card.id}`,
      {
        version: card.version,
        x: card.x + 50,
        y: card.y,
      },
    );
    check(
      "connecting and moving cards leaves version ancestry unchanged",
      link.status === 201 && movedAsset.status === 200 && (await parentCount()) === before,
      before,
    );

    const reviewer = await signedInUser("reviewer");
    extraUsers.push(reviewer.id);
    const added = await owner.api("POST", `/api/projects/${projectId}/members`, {
      email: reviewer.email,
      role: "reviewer",
    });
    const reviewerHistory = await reviewer.api("GET", historyUrl);
    const reviewerMove = await reviewer.api(
      "PATCH",
      `/api/projects/${projectId}/canvas/items/${card.id}`,
      {
        version: 2,
        x: 0,
        y: 0,
      },
    );
    const reviewerCapture = await reviewer.api(
      "POST",
      `/api/projects/${projectId}/assets/${asset.id}/capture`,
      {},
    );
    check(
      "reviewers see history but cannot move cards or capture",
      added.status === 201 &&
        reviewerHistory.status === 200 &&
        reviewerMove.status === 403 &&
        reviewerCapture.status === 403,
      [reviewerHistory.status, reviewerMove.status, reviewerCapture.status],
    );

    // --- Phase 5: selective combination and approval ---
    const fonts = (await trigger("fonts")) as [string, string];
    const captureUrl = `/api/projects/${projectId}/assets/${asset.id}/capture`;
    const captureNow = async (message: string) => {
      const r = await owner.api("POST", captureUrl, { message });
      const done = await waitJob(owner.api, r.body.job.id, "succeeded");
      return done.job.result?.checkpointId as string;
    };
    const switchTo = async (branchId: string) => {
      const r = await owner.api("POST", `/api/projects/${projectId}/assets/${asset.id}/checkout`, {
        branchId,
      });
      const job = await waitFor("switch to finish", async () => {
        const j = await owner.api("GET", `/api/jobs/${r.body.job.id}`);
        return ["succeeded", "failed"].includes(j.body.job?.status) ? j.body.job : undefined;
      });
      if (job.status === "succeeded")
        await waitFor("heartbeat maps the working copy", async () =>
          (await pluginStatus()).assets.some((a: { path: string }) => a.path === job.result?.path),
        );
      return job;
    };
    const setProperty = (layer: string, property: unknown) =>
      trigger("set-property", { layer, property });

    // Two branches from the first checkpoint. "background" recolors the background and the
    // headline; alt changes the headline font and recolors the headline differently.
    const bg = await owner.api("POST", `/api/projects/${projectId}/assets/${asset.id}/branches`, {
      name: "background",
      checkpointId: cp1.id,
    });
    const toBg = await switchTo(bg.body.branch.id);
    check("switching a captured document needs no force", toBg.status === "succeeded", toBg.error);
    await setProperty("Background Color", { type: "fill.color", value: "#8B1E3F" });
    await setProperty("Headline", { type: "text.color", value: "#FFD700" });
    await trigger("save-active");
    const bgHead = await captureNow("Red background, gold headline");

    const toAlt = await switchTo(alt.body.branch.id);
    await setProperty("Headline", { type: "text.font", value: { postScriptName: fonts[1] } });
    await setProperty("Headline", { type: "text.color", value: "#00FF00" });
    await trigger("save-active");
    const fontHead = await captureNow("New headline font, green headline");
    const fontHistory = (await owner.api("GET", historyUrl)).body;
    check(
      "history does not flag a capture that changed text or colors",
      fontHistory.checkpoints.find((c: { id: string }) => c.id === fontHead)?.noPropertyChanges ===
        false,
    );
    check(
      "both branches captured their edits",
      toAlt.status === "succeeded" && !!bgHead && !!fontHead,
      { bgHead, fontHead },
    );

    const combineQuery = `targetBranchId=${alt.body.branch.id}&sourceBranchId=${bg.body.branch.id}`;
    const p5Preview = (
      await owner.api(
        "GET",
        `/api/projects/${projectId}/assets/${asset.id}/combine?${combineQuery}`,
      )
    ).body;
    type Row = { id: string; name: string; property: string; status: string; defaultSide: string };
    const rowFor = (name: string, property: string) =>
      (p5Preview.rows as Row[] | undefined)?.find(
        (r) => r.name === name && r.property === property,
      );
    const fontRow = rowFor("Headline", "text.font");
    const colorRow = rowFor("Headline", "text.color");
    const fillRow = rowFor("Background Color", "fill.color");
    check(
      "combination compares both branches against their shared ancestor",
      p5Preview.base?.id === cp1.id &&
        fontRow?.status === "target" &&
        fillRow?.status === "source" &&
        fillRow.defaultSide === "source" &&
        colorRow?.status === "conflict" &&
        colorRow.defaultSide === null,
      {
        base: p5Preview.base?.id === cp1.id,
        font: fontRow?.status,
        fill: fillRow?.status,
        color: colorRow?.status,
      },
    );

    const proposalsUrl = `/api/projects/${projectId}/assets/${asset.id}/proposals`;
    const body = { targetBranchId: alt.body.branch.id, sourceBranchId: bg.body.branch.id };
    const unresolved = await owner.api("POST", proposalsUrl, body);
    check(
      "a conflicting property must be resolved before a candidate is made",
      unresolved.status === 422 && unresolved.body.error?.code === "CONFLICT_UNRESOLVED",
      unresolved.body.error?.message,
    );

    const p5Created = await owner.api("POST", proposalsUrl, {
      ...body,
      resolutions: { [colorRow!.id]: "target" },
    });
    const built = await waitJob(owner.api, p5Created.body.job?.id, "succeeded", 120_000).catch(
      () => undefined,
    );
    const listed = (await owner.api("GET", proposalsUrl)).body.proposals?.[0];
    const candidate = listed?.candidate;
    check(
      "plugin builds a candidate from a copy and the proposal becomes ready",
      p5Created.status === 201 && !!built && listed?.status === "ready" && !!candidate?.previewUrl,
      listed?.status ?? p5Created.body.error?.message,
    );

    type El = { name: string; properties: Array<{ type: string; value: unknown }> };
    const prop = (elements: El[] | undefined, name: string, type: string) =>
      elements?.find((e) => e.name === name)?.properties.find((p) => p.type === type)?.value;
    const cand = candidate?.elements as El[] | undefined;
    const { data: cp1Row } = await admin
      .from("checkpoints")
      .select("manifest")
      .eq("id", cp1.id)
      .single();
    const baseElements = cp1Row?.manifest.elements as El[];
    check(
      "candidate takes alt's font and the background branch's color, keeping the chosen headline color",
      (prop(cand, "Headline", "text.font") as { postScriptName?: string })?.postScriptName ===
        fonts[1] &&
        prop(cand, "Background Color", "fill.color") === "#8B1E3F" &&
        prop(cand, "Headline", "text.color") === "#00FF00",
    );
    check(
      "unselected content is preserved",
      ["text.content", "text.size"].every(
        (t) => prop(cand, "Headline", t) === prop(baseElements, "Headline", t),
      ) &&
        ["text.content", "text.font", "text.size", "text.color"].every(
          (t) =>
            JSON.stringify(prop(cand, "Body", t)) === JSON.stringify(prop(baseElements, "Body", t)),
        ),
    );
    const beforeApproval = (await owner.api("GET", historyUrl)).body;
    check(
      "the candidate stays out of history until approved",
      !beforeApproval.checkpoints.some((c: { id: string }) => c.id === candidate?.id),
    );

    const { data: sourcesBefore } = await admin
      .from("checkpoints")
      .select("id,native_digest,preview_digest,status")
      .in("id", [cp1.id, fontHead, bgHead]);
    const p5Approved = await owner.api(
      "POST",
      `/api/projects/${projectId}/proposals/${listed?.id}/approve`,
      { candidateCheckpointId: candidate?.id },
    );
    const afterApproval = (await owner.api("GET", historyUrl)).body;
    const altHead = afterApproval.branches.find(
      (b: { id: string }) => b.id === alt.body.branch.id,
    )?.head_checkpoint_id;
    const merged = afterApproval.checkpoints.find((c: { id: string }) => c.id === candidate?.id);
    check(
      "approval finalizes the candidate on alt with both branch heads as parents",
      p5Approved.status === 200 &&
        altHead === candidate?.id &&
        [...(merged?.parents ?? [])].sort().join() === [fontHead, bgHead].sort().join(),
      p5Approved.body.error?.message ?? merged?.parents,
    );

    const { data: approvedRow } = await admin
      .from("checkpoints")
      .select("native_path,preview_path,manifest")
      .eq("id", candidate?.id)
      .single();
    const { data: item } = await admin
      .from("proposal_items")
      .select("outcome")
      .eq("proposal_id", listed?.id)
      .single();
    const bytesOf = async (bucket: string, path: string) =>
      new Uint8Array(await (await admin.storage.from(bucket).download(path)).data!.arrayBuffer());
    const p5NativeBytes = await bytesOf("snapshots", approvedRow!.native_path);
    const previewBytesApproved = await bytesOf("previews", approvedRow!.preview_path);
    check(
      "the approved artifact matches the preview that was reviewed",
      fnv1a64(previewBytesApproved) === item?.outcome.previewDigest &&
        item?.outcome.previewDigest === candidate?.previewDigest &&
        fnv1a64(p5NativeBytes) === item?.outcome.nativeDigest &&
        item?.outcome.nativeDigest === approvedRow!.manifest.files.native.digest,
    );
    const { data: sourcesAfter } = await admin
      .from("checkpoints")
      .select("id,native_digest,preview_digest,status")
      .in("id", [cp1.id, fontHead, bgHead]);
    check(
      "all source checkpoints are preserved",
      sourcesAfter?.length === 3 &&
        JSON.stringify(sourcesAfter?.sort((a, b) => a.id.localeCompare(b.id))) ===
          JSON.stringify(sourcesBefore?.sort((a, b) => a.id.localeCompare(b.id))),
    );
    const p5Again = await owner.api(
      "POST",
      `/api/projects/${projectId}/proposals/${listed?.id}/approve`,
      { candidateCheckpointId: candidate?.id },
    );
    check("an approved proposal cannot be approved twice", p5Again.status === 409, p5Again.status);

    check(
      "approval does not flag the open document as uncaptured",
      await documentState(false, false),
    );
    const opened = await switchTo(alt.body.branch.id);
    check(
      "the approved result opens in Photoshop without force",
      opened.status === "succeeded" && opened.result?.checkpointId === candidate?.id,
      opened.error?.message,
    );
    check("the opened result reports no uncaptured changes", await documentState(false, false));
    const nothing = await owner.api("POST", proposalsUrl, body);
    check(
      "combining the same branches again finds nothing new",
      nothing.status === 422 && nothing.body.error?.code === "NOTHING_TO_COMBINE",
      nothing.body.error?.code,
    );

    // --- Phase 6: one theme across two documents, with a partial failure ---
    const second = await trigger("open-fixture");
    if (typeof second.path === "string") ownDocuments.push(second.path.replace(/[^/]+$/, ""));
    const flyer = await trigger("link", { projectId });
    ownDocuments.push(`/working/${flyer.id}/`);
    await waitFor("heartbeat maps the second document", async () =>
      (await pluginStatus()).assets.some((a: { assetId: string }) => a.assetId === flyer.id),
    );
    const flyerCapture = await owner.api(
      "POST",
      `/api/projects/${projectId}/assets/${flyer.id}/capture`,
      { message: "Flyer first version" },
    );
    await waitJob(owner.api, flyerCapture.body.job.id, "succeeded");

    const themeColors = {
      primary: "#123456",
      background: "#2E7D32",
      text: "#FFF8E1",
      accent: "#FFB300",
    };
    const themeRes = await owner.api("POST", `/api/projects/${projectId}/themes`, {
      name: "Forest",
      colors: themeColors,
      x: 1200,
      y: 100,
    });
    const themeUrl = `/api/projects/${projectId}/themes/${themeRes.body.theme?.id}`;
    type Mappable = { native: unknown; name: string };
    const detail = (await owner.api("GET", themeUrl)).body;
    for (const doc of [asset.id, flyer.id] as string[]) {
      const elements = detail.assets.find((a: { id: string }) => a.id === doc)
        .elements as Mappable[];
      await owner.api("PUT", `${themeUrl}/mappings/${doc}`, {
        elements: elements.map((e) => ({
          native: e.native,
          colorRole:
            e.name === "Background Color" ? "background" : e.name === "Headline" ? "text" : null,
        })),
      });
    }
    const planned = (await owner.api("GET", themeUrl)).body.plans as Array<{
      assetId: string;
      status: string;
    }>;
    check(
      "a theme maps to layers of two documents, each checked before running",
      themeRes.status === 201 &&
        [asset.id, flyer.id].every(
          (id) => planned.find((p) => p.assetId === id)?.status === "ready",
        ),
      planned.map((p) => p.status),
    );

    const headsBefore = Object.fromEntries(
      await Promise.all(
        [asset.id, flyer.id].map(async (id: string) => [
          id,
          (
            await admin
              .from("assets")
              .select("branches!assets_active_branch_fk(head_checkpoint_id)")
              .eq("id", id)
              .single()
          ).data?.branches as unknown as { head_checkpoint_id: string },
        ]),
      ),
    );
    await trigger("fault", { stage: "fail-candidate" });
    const applied = await owner.api("POST", `${themeUrl}/apply`, {
      assetIds: [asset.id, flyer.id],
    });
    type Update = {
      id: string;
      status: string;
      items: Array<{ id: string; assetId: string; status: string; candidateCheckpointId: string }>;
    };
    const settled = async () =>
      waitFor(
        "theme candidates to settle",
        async () => {
          const u = (await owner.api("GET", `${themeUrl}/proposals`)).body.proposals?.[0] as Update;
          return u && u.status !== "preparing" ? u : undefined;
        },
        180_000,
      );
    const partial = await settled();
    const failedItem = partial.items.find((i) => i.status === "failed");
    const readyItem = partial.items.find((i) => i.status === "ready");
    check(
      "a failure in one document is visible and does not block the other",
      applied.status === 201 &&
        partial.status === "partially_failed" &&
        !!failedItem &&
        !!readyItem,
      partial.items.map((i) => i.status),
    );

    const firstApproval = await owner.api(
      "POST",
      `/api/projects/${projectId}/proposals/${partial.id}/approve-items`,
      {
        items: [{ itemId: readyItem?.id, candidateCheckpointId: readyItem?.candidateCheckpointId }],
      },
    );
    check(
      "approving the successful document keeps the update marked incomplete",
      firstApproval.status === 200 && firstApproval.body.proposal?.status === "partially_failed",
      firstApproval.body.proposal?.status,
    );

    await owner.api(
      "POST",
      `/api/projects/${projectId}/proposals/${partial.id}/items/${failedItem?.id}/retry`,
    );
    const retried = await settled();
    const retriedItem = retried.items.find((i) => i.id === failedItem?.id);
    const secondApproval = await owner.api(
      "POST",
      `/api/projects/${projectId}/proposals/${partial.id}/approve-items`,
      {
        items: [
          { itemId: retriedItem?.id, candidateCheckpointId: retriedItem?.candidateCheckpointId },
        ],
      },
    );
    check(
      "the failed document is retried on its own and the update completes",
      retriedItem?.status === "ready" && secondApproval.body.proposal?.status === "finalized",
      [retriedItem?.status, secondApproval.body.proposal?.status],
    );

    type ManifestEl = { name: string; properties: Array<{ type: string; value: unknown }> };
    const themed = await Promise.all(
      [asset.id, flyer.id].map(async (id: string) => {
        const { data } = await admin
          .from("assets")
          .select("branches!assets_active_branch_fk(head_checkpoint_id)")
          .eq("id", id)
          .single();
        const headId = (data?.branches as unknown as { head_checkpoint_id: string })
          .head_checkpoint_id;
        const { data: cp } = await admin
          .from("checkpoints")
          .select("manifest")
          .eq("id", headId)
          .single();
        const { data: parents } = await admin
          .from("checkpoint_parents")
          .select("parent_id")
          .eq("checkpoint_id", headId);
        const els = cp?.manifest.elements as ManifestEl[];
        const value = (name: string, type: string) =>
          els.find((e) => e.name === name)?.properties.find((p) => p.type === type)?.value;
        return {
          background: value("Background Color", "fill.color"),
          headline: value("Headline", "text.color"),
          parent: parents?.[0]?.parent_id,
          before: headsBefore[id]?.head_checkpoint_id,
        };
      }),
    );
    check(
      "one theme updated both documents through their mappings",
      themed.every(
        (t) => t.background === themeColors.background && t.headline === themeColors.text,
      ),
      themed.map((t) => [t.background, t.headline]),
    );
    const { data: previous } = await admin
      .from("checkpoints")
      .select("id,status")
      .in(
        "id",
        themed.map((t) => t.before),
      );
    check(
      "each themed result builds on, and keeps, the version before it",
      themed.every((t) => t.parent === t.before) &&
        previous?.length === 2 &&
        previous.every((p) => p.status === "finalized"),
    );

    // --- Phase 6: directions pin exact versions and reopen them ---
    const pinnedVersions = Object.fromEntries(
      await Promise.all(
        [asset.id, flyer.id].map(async (id: string) => {
          const { data } = await admin
            .from("assets")
            .select("branches!assets_active_branch_fk(head_checkpoint_id)")
            .eq("id", id)
            .single();
          return [
            id,
            (data?.branches as unknown as { head_checkpoint_id: string }).head_checkpoint_id,
          ];
        }),
      ),
    ) as Record<string, string>;
    const savedDirection = await owner.api("POST", `/api/projects/${projectId}/directions`, {
      name: "Forest launch",
      description: "Both documents in the forest theme",
      entries: Object.entries(pinnedVersions).map(([assetId, checkpointId]) => ({
        assetId,
        checkpointId,
      })),
      x: 1200,
      y: 500,
    });
    const directionUrl = `/api/projects/${projectId}/directions/${savedDirection.body.direction?.id}`;

    // The flyer moves on after the direction was saved.
    const moveOn = await owner.api(
      "POST",
      `/api/projects/${projectId}/assets/${flyer.id}/capture`,
      {
        message: "Flyer after the direction",
      },
    );
    await waitJob(owner.api, moveOn.body.job.id, "succeeded");
    const directionView = (await owner.api("GET", directionUrl)).body;
    type Entry = { assetId: string; checkpointId: string; isCurrent: boolean };
    const flyerEntry = (directionView.entries as Entry[] | undefined)?.find(
      (e) => e.assetId === flyer.id,
    );
    check(
      "a direction keeps the exact versions it was saved with as branches move on",
      savedDirection.status === 201 &&
        (directionView.entries as Entry[]).every(
          (e) => e.checkpointId === pinnedVersions[e.assetId],
        ) &&
        flyerEntry?.isCurrent === false,
      directionView.entries?.map((e: Entry) => e.isCurrent),
    );

    const reopened = await owner.api("POST", `${directionUrl}/open`, { assetIds: [flyer.id] });
    const reopenJob = await waitFor("reopening the direction", async () => {
      const j = await owner.api("GET", `/api/jobs/${reopened.body.opened?.[0]?.jobId}`);
      return ["succeeded", "failed"].includes(j.body.job?.status) ? j.body.job : undefined;
    });
    const { data: flyerNow } = await admin
      .from("assets")
      .select("branches!assets_active_branch_fk(name,head_checkpoint_id)")
      .eq("id", flyer.id)
      .single();
    const flyerBranch = flyerNow?.branches as unknown as {
      name: string;
      head_checkpoint_id: string;
    };
    check(
      "reopening a direction opens the saved version on its own branch",
      reopenJob.status === "succeeded" &&
        reopenJob.result?.checkpointId === pinnedVersions[flyer.id] &&
        flyerBranch.name === "Forest launch" &&
        flyerBranch.head_checkpoint_id === pinnedVersions[flyer.id],
      [reopenJob.status, flyerBranch?.name, reopenJob.error?.message],
    );

    // --- Routing: a job for a document that is not open is not delivered ---
    const closedAsset = await owner.api("POST", `/api/projects/${projectId}/assets`, {
      name: "Closed",
      application: "photoshop",
      nativeLocator: { path: "/nonexistent/closed.psd" },
    });
    const closedJob = await owner.api("POST", `/api/projects/${projectId}/jobs`, {
      operation: "captureCheckpoint",
      assetId: closedAsset.body.asset.id,
      operationId: `e2e-${randomUUID()}`,
    });
    await sleep(10_000);
    const still = await owner.api("GET", `/api/jobs/${closedJob.body.job.id}`);
    check(
      "job for an unopened document stays queued",
      still.body.job.status === "queued" && still.body.job.attempts === 0,
    );
    const keepHistory = await owner.api("DELETE", `/api/projects/${projectId}/assets/${asset.id}`);
    const removeEmpty = await owner.api(
      "DELETE",
      `/api/projects/${projectId}/assets/${closedAsset.body.asset.id}`,
    );
    const { count: closedLeft } = await admin
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("id", closedAsset.body.asset.id);
    check(
      "empty documents delete directly; documents with history need explicit confirmation",
      keepHistory.status === 409 && removeEmpty.status === 204 && closedLeft === 0,
      [keepHistory.status, removeEmpty.status],
    );

    // --- Authorization ---
    const outsiderAssets = await outsider.api("GET", `/api/projects/${projectId}/assets`);
    const outsiderJob = await outsider.api("POST", `/api/projects/${projectId}/jobs`, {
      operation: "captureCheckpoint",
      assetId: asset.id,
      operationId: `e2e-${randomUUID()}`,
    });
    const outsiderRead = await outsider.api("GET", `/api/jobs/${job1.body.job.id}`);
    const { data: outsiderFile } = await outsider.client.storage
      .from("snapshots")
      .download(cpRow!.native_path);
    check(
      "outsider cannot list, create jobs, read jobs or download artifacts",
      outsiderAssets.status === 404 &&
        outsiderJob.status === 404 &&
        outsiderRead.status === 404 &&
        !outsiderFile,
      [outsiderAssets.status, outsiderJob.status, outsiderRead.status],
    );
    // A connection made and ended directly over HTTP: disconnecting revokes it on the server.
    const json = (path: string, body: unknown, token?: string) =>
      fetch(`${BASE}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    const started = await (
      await json("/api/connector/pair/start", {
        manifest: {
          application: "photoshop",
          connectorVersion: "0.3.0",
          assetTypes: ["psd"],
          operations: ["reportStatus"],
          elementKinds: [],
          previewFormats: ["image/png"],
          runtime: {},
          limitations: [],
        },
      })
    ).json();
    await owner.api("POST", "/api/connector/pair/approve", { code: started.code });
    const paired = await (
      await json("/api/connector/pair/poll", {
        sessionId: started.sessionId,
        pollSecret: started.pollSecret,
      })
    ).json();
    const beat = async () =>
      (await json("/api/connector/heartbeat", { openDocuments: [] }, paired.token)).status;
    const beforeDisconnect = await beat();
    const disconnected = await json("/api/connector/disconnect", {}, paired.token);
    const afterDisconnect = await beat();
    const renewAfterDisconnect = await json("/api/connector/refresh", {
      refreshToken: paired.refreshToken,
    });
    const { data: revoked } = await admin
      .from("connector_sessions")
      .select("status")
      .eq("id", started.sessionId)
      .single();
    check(
      "disconnecting revokes the connection and its renewal on the server",
      beforeDisconnect === 200 &&
        disconnected.status === 204 &&
        afterDisconnect === 401 &&
        renewAfterDisconnect.status === 401 &&
        revoked?.status === "revoked",
      [
        beforeDisconnect,
        disconnected.status,
        afterDisconnect,
        renewAfterDisconnect.status,
        revoked?.status,
      ],
    );

    const fake = await fetch(`${BASE}/api/connector/jobs/claim`, {
      method: "POST",
      headers: { authorization: "Bearer not-a-token" },
    });
    const anon = createClient(url, publishableKey, { auth: { persistSession: false } });
    const anonRpc = await anon.rpc("claim_job", { p_session_id: session!.id });
    const userRpc = await owner.client.rpc("claim_job", { p_session_id: session!.id });
    check(
      "invalid tokens and direct RPC calls cannot claim jobs",
      fake.status === 401 && !!anonRpc.error && !!userRpc.error,
      [fake.status, anonRpc.error?.code, userRpc.error?.code],
    );

    // --- Token expiry: remembered connections renew; ended ones ask to pair again ---
    const tokenHash = async () =>
      (
        await admin
          .from("connector_sessions")
          .select("token_hash,expires_at,status")
          .eq("id", session!.id)
          .single()
      ).data!;
    const beforeExpiry = await tokenHash();
    await admin
      .from("connector_sessions")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", session!.id);
    const renewed = await waitFor(
      "plugin renews its expired access token",
      async () => {
        const row = await tokenHash();
        return row.token_hash !== beforeExpiry.token_hash &&
          new Date(row.expires_at).getTime() > Date.now()
          ? row
          : undefined;
      },
      30_000,
    ).catch(() => undefined);
    const stillActive = (await pluginStatus()).connection.state;
    check(
      "an expired access token is renewed without pairing again",
      !!renewed && stillActive === "active",
      stillActive,
    );

    await admin
      .from("connector_sessions")
      .update({
        expires_at: new Date(Date.now() - 1000).toISOString(),
        refresh_expires_at: new Date(Date.now() - 1000).toISOString(),
      })
      .eq("id", session!.id);
    const expired = await waitFor(
      "plugin notices the connection ended",
      async () => {
        const s = await pluginStatus();
        return s.connection.state === "expired" ? s : undefined;
      },
      30_000,
    );
    check(
      "a connection unused past its limit asks to pair again",
      expired.connection.state === "expired",
      expired.connection.reason,
    );
  } finally {
    if (projectId) {
      await removeProjectFiles(projectId);
      await admin.from("projects").delete().eq("id", projectId);
    }
    await admin.auth.admin.deleteUser(owner.id);
    await admin.auth.admin.deleteUser(outsider.id);
    for (const id of extraUsers) await admin.auth.admin.deleteUser(id);
    await trigger("disconnect").catch(() => undefined);
    await trigger("restore-session").catch(() => undefined);
    for (const match of ownDocuments) await trigger("close-docs", { match }).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    failures++;
    console.error("FAIL ", error instanceof Error ? error.message : error);
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed` : "\nAll end-to-end checks passed");
    process.exit(failures ? 1 : 0);
  });
