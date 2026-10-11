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
  try {
    const created = await owner.api("POST", "/api/projects", { name: "E2E posters" });
    projectId = created.body.project?.id;
    check(
      "owner creates a project through the API",
      created.status === 201 && !!projectId,
      created.status,
    );

    const doc = await trigger("open-fixture");
    check("Photoshop opens a saved test document", typeof doc.path === "string", doc.path);

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
    check("plugin links the open document as a project asset", !!asset.id, asset.name);
    await waitFor("heartbeat reports the asset", async () =>
      (await pluginStatus()).assets.some((a: { assetId: string }) => a.assetId === asset.id),
    );
    check("heartbeat maps the open document to the asset", true);

    // --- Capture through a job ---
    const op1 = `e2e-${randomUUID()}`;
    const job1 = await owner.api("POST", `/api/projects/${projectId}/jobs`, {
      operation: "captureCheckpoint",
      assetId: asset.id,
      operationId: op1,
      params: { message: "Original" },
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

    const again = await owner.api("POST", `/api/projects/${projectId}/jobs`, {
      operation: "captureCheckpoint",
      assetId: asset.id,
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
    const job2 = await owner.api("POST", `/api/projects/${projectId}/jobs`, {
      operation: "captureCheckpoint",
      assetId: asset.id,
      operationId: op2,
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

    // --- Routing: a job for a document that is not open is not delivered ---
    const closedAsset = await owner.api("POST", `/api/projects/${projectId}/assets`, {
      name: "Closed",
      application: "photoshop",
      nativeLocator: { path: "/nonexistent/closed.psd" },
    });
    const job3 = await owner.api("POST", `/api/projects/${projectId}/jobs`, {
      operation: "captureCheckpoint",
      assetId: closedAsset.body.asset.id,
      operationId: `e2e-${randomUUID()}`,
    });
    await sleep(10_000);
    const still = await owner.api("GET", `/api/jobs/${job3.body.job.id}`);
    check(
      "job for an unopened document stays queued",
      still.body.job.status === "queued" && still.body.job.attempts === 0,
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

    // --- Token expiry ---
    await admin
      .from("connector_sessions")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", session!.id);
    const expired = await waitFor(
      "plugin notices expiry",
      async () => {
        const s = await pluginStatus();
        return s.connection.state === "expired" ? s : undefined;
      },
      30_000,
    );
    check(
      "expired connector token stops the plugin and asks to pair again",
      true,
      expired.connection.reason,
    );
  } finally {
    if (projectId) {
      await removeProjectFiles(projectId);
      await admin.from("projects").delete().eq("id", projectId);
    }
    await admin.auth.admin.deleteUser(owner.id);
    await admin.auth.admin.deleteUser(outsider.id);
    await trigger("disconnect").catch(() => undefined);
    await trigger("close-docs", { match: "/feasibility/docs-e2e" }).catch(() => undefined);
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
