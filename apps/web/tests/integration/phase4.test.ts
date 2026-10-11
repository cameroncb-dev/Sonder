import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { adminClient, createSession, createUser, manifest, opId, type TestUser } from "./helpers";

let admin: SupabaseClient;
let editor: TestUser;
let projectId: string;
let assetId: string;
let otherAssetId: string;
let session: string;

async function rpc<T = Record<string, unknown>>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

async function leasedJob(operation: string, params: Record<string, unknown>, asset = assetId) {
  const job = await rpc<{ id: string }>(editor.client, "create_job", {
    p_project_id: projectId,
    p_asset_id: asset,
    p_operation: operation,
    p_operation_id: opId(),
    p_params: params,
    p_requires_asset_session: false,
  });
  let leased = await rpc<{ id: string | null }>(admin, "claim_job", { p_session_id: session });
  while (leased.id && leased.id !== job.id)
    leased = await rpc(admin, "claim_job", { p_session_id: session });
  expect(leased.id).toBe(job.id);
  return job.id;
}

/** Runs a capture through begin → files; finalize optional so tests can interleave. */
async function capture(params: Record<string, unknown> = {}, asset = assetId) {
  const jobId = await leasedJob("captureCheckpoint", params, asset);
  const c = await rpc<{ id: string }>(admin, "begin_checkpoint", {
    p_session_id: session,
    p_job_id: jobId,
    p_manifest: manifest(),
  });
  for (const [kind, digest] of [
    ["native", "0000000000000001"],
    ["preview", "0000000000000002"],
  ]) {
    await rpc(admin, "record_checkpoint_file", {
      p_session_id: session,
      p_checkpoint_id: c.id,
      p_kind: kind,
      p_path: `${projectId}/${asset}/${c.id}/${kind}`,
      p_bytes: 10,
      p_digest: digest,
    });
  }
  const finalize = () =>
    rpc<{ id: string }>(admin, "finalize_checkpoint", {
      p_session_id: session,
      p_checkpoint_id: c.id,
    });
  const job = async () =>
    (await admin.from("jobs").select("status,result").eq("id", jobId).single()).data!;
  return { id: c.id, jobId, finalize, job };
}

const branches = async () =>
  (
    await admin
      .from("branches")
      .select("id,name,head_checkpoint_id")
      .eq("asset_id", assetId)
      .order("created_at")
  ).data!;
const activeBranch = async () =>
  (await admin.from("assets").select("active_branch_id,native_locator").eq("id", assetId).single())
    .data!;
const parentsOf = async (id: string) =>
  (
    (await admin.from("checkpoint_parents").select("parent_id").eq("checkpoint_id", id)).data ?? []
  ).map((p) => p.parent_id);

beforeAll(async () => {
  admin = adminClient();
  editor = await createUser(admin, "p4-editor");
  projectId = (await rpc<{ id: string }>(editor.client, "create_project", { p_name: "Phase 4" }))
    .id;
  const { data } = await editor.client
    .from("assets")
    .insert([
      {
        project_id: projectId,
        application: "photoshop",
        name: "Poster",
        native_locator: { path: "/tmp/p4/poster.psd" },
      },
      {
        project_id: projectId,
        application: "photoshop",
        name: "Flyer",
        native_locator: { path: "/tmp/p4/flyer.psd" },
      },
    ])
    .select("id");
  [assetId, otherAssetId] = data!.map((a) => a.id as string) as [string, string];
  session = await createSession(admin, editor.id, {
    operations: ["captureCheckpoint", "openCheckpoint"],
  });
});

describe("branch-aware history", () => {
  let first: string, second: string, mainId: string, altId: string;

  it("creates and activates main on an asset's first checkpoint", async () => {
    const c = await capture();
    await c.finalize();
    first = c.id;
    const [main] = await branches();
    expect(main).toMatchObject({ name: "main", head_checkpoint_id: first });
    mainId = main!.id;
    expect((await activeBranch()).active_branch_id).toBe(mainId);
    expect((await c.job()).result).toMatchObject({
      checkpointId: first,
      branchId: mainId,
      branchAdvanced: true,
    });
  });

  it("records the branch head as parent and advances the branch", async () => {
    const c = await capture({ branchId: mainId });
    await c.finalize();
    second = c.id;
    expect(await parentsOf(second)).toEqual([first]);
    expect((await branches()).find((b) => b.id === mainId)!.head_checkpoint_id).toBe(second);
  });

  it("branches from an earlier checkpoint without touching the source", async () => {
    const { data, error } = await editor.client
      .from("branches")
      .insert({ asset_id: assetId, name: "alt", head_checkpoint_id: first, created_by: editor.id })
      .select("id")
      .single();
    expect(error).toBeNull();
    altId = data!.id;

    const c = await capture({ branchId: altId });
    await c.finalize();
    expect(await parentsOf(c.id)).toEqual([first]);
    const after = await branches();
    expect(after.find((b) => b.id === altId)!.head_checkpoint_id).toBe(c.id);
    expect(after.find((b) => b.id === mainId)!.head_checkpoint_id).toBe(second);
    const { data: sources } = await admin
      .from("checkpoints")
      .select("id,status")
      .in("id", [first, second]);
    expect(sources).toHaveLength(2);
    expect(sources!.every((s) => s.status === "finalized")).toBe(true);
  });

  it("does not advance a branch that moved while a capture was in flight", async () => {
    const a = await capture({ branchId: mainId });
    const b = await capture({ branchId: mainId });
    await a.finalize();
    await b.finalize();
    expect((await a.job()).result).toMatchObject({ branchAdvanced: true });
    expect((await b.job()).result).toMatchObject({ branchAdvanced: false });
    expect((await branches()).find((x) => x.id === mainId)!.head_checkpoint_id).toBe(a.id);
    expect(await parentsOf(b.id)).toEqual([second]);
  });

  it("switches the active branch only when a checkout succeeds", async () => {
    const failing = await leasedJob("openCheckpoint", { branchId: altId, checkpointId: first });
    await rpc(admin, "fail_job", {
      p_session_id: session,
      p_job_id: failing,
      p_error: { code: "UNSAVED_CHANGES", message: "x" },
      p_retryable: false,
    });
    expect((await activeBranch()).active_branch_id).toBe(mainId);

    const job = await leasedJob("openCheckpoint", { branchId: altId, checkpointId: first });
    await rpc(admin, "complete_job", {
      p_session_id: session,
      p_job_id: job,
      p_result: { path: "/tmp/p4/working/alt.psd" },
    });
    const asset = await activeBranch();
    expect(asset.active_branch_id).toBe(altId);
    expect(asset.native_locator).toEqual({ path: "/tmp/p4/working/alt.psd" });
  });

  it("rejects an active branch that belongs to another asset", async () => {
    const { error } = await admin
      .from("assets")
      .update({ active_branch_id: mainId })
      .eq("id", otherAssetId);
    expect(error).not.toBeNull();
  });
});

describe("canvas", () => {
  it("enforces optimistic concurrency on saves", async () => {
    const { data: item } = await editor.client
      .from("canvas_items")
      .insert({ project_id: projectId, item_type: "note", x: 10, y: 20, content: { text: "hi" } })
      .select("id,version")
      .single();
    const ok = await editor.client
      .from("canvas_items")
      .update({ x: 50, version: item!.version + 1 })
      .eq("id", item!.id)
      .eq("version", item!.version)
      .select("version");
    expect(ok.data).toEqual([{ version: 2 }]);
    // A client still holding version 1 cannot overwrite version 2.
    const stale = await editor.client
      .from("canvas_items")
      .update({ x: 99, version: 2 })
      .eq("id", item!.id)
      .eq("version", 1)
      .select("version");
    expect(stale.data).toEqual([]);
    const skipped = await editor.client
      .from("canvas_items")
      .update({ x: 99, version: 5 })
      .eq("id", item!.id)
      .select("version");
    expect(skipped.error?.code).toBe("23514");
    const { data: final } = await admin
      .from("canvas_items")
      .select("x,version")
      .eq("id", item!.id)
      .single();
    expect(final).toEqual({ x: 50, version: 2 });
  });

  it("keeps one asset per linked document and one card per asset", async () => {
    const duplicate = await editor.client.from("assets").insert({
      project_id: projectId,
      application: "photoshop",
      name: "Flyer again",
      native_locator: { path: "/tmp/p4/flyer.psd" },
    });
    expect(duplicate.error?.code).toBe("23505");
    const card = { project_id: projectId, item_type: "asset", ref_id: assetId };
    expect((await editor.client.from("canvas_items").insert(card)).error).toBeNull();
    expect((await editor.client.from("canvas_items").insert(card)).error?.code).toBe("23505");
    await admin.from("canvas_items").delete().eq("project_id", projectId).eq("ref_id", assetId);
  });

  it("never changes checkpoint ancestry when cards are connected", async () => {
    const { count: before } = await admin
      .from("checkpoint_parents")
      .select("*", { count: "exact", head: true });
    const { data: items } = await editor.client
      .from("canvas_items")
      .insert([
        { project_id: projectId, item_type: "asset", ref_id: assetId },
        { project_id: projectId, item_type: "asset", ref_id: otherAssetId },
      ])
      .select("id");
    const connection = await editor.client
      .from("canvas_connections")
      .insert({ project_id: projectId, from_item_id: items![0]!.id, to_item_id: items![1]!.id });
    expect(connection.error).toBeNull();
    const { count: after } = await admin
      .from("checkpoint_parents")
      .select("*", { count: "exact", head: true });
    expect(after).toBe(before);
  });
});
