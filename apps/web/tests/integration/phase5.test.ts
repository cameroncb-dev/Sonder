import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { adminClient, createSession, createUser, manifest, opId, type TestUser } from "./helpers";

let admin: SupabaseClient;
let editor: TestUser;
let reviewer: TestUser;
let projectId: string;
let assetId: string;
let session: string;
let base: string;
let fontHead: string;
let bgHead: string;
let fontBranch: string;
let bgBranch: string;

async function rpc<T = Record<string, unknown>>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw Object.assign(new Error(`${fn}: ${error.message}`), { code: error.code });
  return data as T;
}

const errorCode = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (e: { code?: string }) => e.code,
  );

/** Claims the next job for the test session, which must be `jobId`. */
async function claim(jobId: string) {
  let leased = await rpc<{ id: string | null }>(admin, "claim_job", { p_session_id: session });
  while (leased.id && leased.id !== jobId)
    leased = await rpc(admin, "claim_job", { p_session_id: session });
  expect(leased.id).toBe(jobId);
}

/** Runs a leased job's checkpoint upload: begin → files → finalize. */
async function uploadFor(jobId: string, digest: string) {
  const c = await rpc<{ id: string }>(admin, "begin_checkpoint", {
    p_session_id: session,
    p_job_id: jobId,
    p_manifest: manifest(digest, `${digest.slice(0, 15)}f`),
  });
  for (const [kind, d] of [
    ["native", digest],
    ["preview", `${digest.slice(0, 15)}f`],
  ]) {
    await rpc(admin, "record_checkpoint_file", {
      p_session_id: session,
      p_checkpoint_id: c.id,
      p_kind: kind,
      p_path: `${projectId}/${assetId}/${c.id}/${kind}`,
      p_bytes: 10,
      p_digest: d,
    });
  }
  await rpc(admin, "finalize_checkpoint", { p_session_id: session, p_checkpoint_id: c.id });
  return c.id;
}

async function capture(branchId: string | null, digest: string) {
  const job = await rpc<{ id: string }>(editor.client, "create_job", {
    p_project_id: projectId,
    p_asset_id: assetId,
    p_operation: "captureCheckpoint",
    p_operation_id: opId(),
    p_params: branchId ? { branchId } : {},
    p_requires_asset_session: false,
  });
  await claim(job.id);
  return uploadFor(job.id, digest);
}

const head = async (branchId: string) =>
  (await admin.from("branches").select("head_checkpoint_id").eq("id", branchId).single()).data!
    .head_checkpoint_id as string;

function propose(target = fontBranch, targetHead = fontHead, client = editor.client) {
  return rpc<{
    proposal: { id: string };
    item: { id: string };
    job: { id: string; params: Record<string, unknown> };
  }>(client, "create_combination_proposal", {
    p_project_id: projectId,
    p_asset_id: assetId,
    p_request: {
      targetBranchId: target,
      targetCheckpointId: targetHead,
      sourceBranchId: bgBranch,
      sourceCheckpointId: bgHead,
      baseCheckpointId: base,
    },
    p_operation_id: opId(),
    p_job_params: { changeSet: { mappings: [], changes: [] } },
  });
}

beforeAll(async () => {
  admin = adminClient();
  editor = await createUser(admin, "p5-editor");
  reviewer = await createUser(admin, "p5-reviewer");
  projectId = (await rpc<{ id: string }>(editor.client, "create_project", { p_name: "Phase 5" }))
    .id;
  await admin
    .from("project_members")
    .insert({ project_id: projectId, user_id: reviewer.id, role: "reviewer" });
  const { data } = await editor.client
    .from("assets")
    .insert({
      project_id: projectId,
      application: "photoshop",
      name: "Poster",
      native_locator: { path: "/tmp/p5/poster.psd" },
    })
    .select("id")
    .single();
  assetId = data!.id;
  session = await createSession(admin, editor.id, {
    operations: ["captureCheckpoint", "createCandidate", "openCheckpoint"],
  });

  base = await capture(null, "00000000000000a1");
  const branch = async (name: string) =>
    (
      await editor.client
        .from("branches")
        .insert({ asset_id: assetId, name, head_checkpoint_id: base, created_by: editor.id })
        .select("id")
        .single()
    ).data!.id as string;
  fontBranch = await branch("font");
  bgBranch = await branch("background");
  fontHead = await capture(fontBranch, "00000000000000b1");
  bgHead = await capture(bgBranch, "00000000000000c1");
});

describe("combination proposals", () => {
  let proposalId: string;
  let itemId: string;
  let jobId: string;
  let candidate: string;

  it("creates a proposal bound to exact checkpoints with a candidate job", async () => {
    const created = await propose();
    proposalId = created.proposal.id;
    itemId = created.item.id;
    jobId = created.job.id;
    expect(created.job.params).toMatchObject({
      proposalId,
      proposalItemId: itemId,
      parentIds: [fontHead, bgHead],
    });
    const { data: item } = await admin.from("proposal_items").select("*").eq("id", itemId).single();
    expect(item).toMatchObject({ status: "running", source_checkpoint_ids: [fontHead, bgHead] });
  });

  it("refuses proposals from reviewers, for moved branches, or across assets", async () => {
    expect(await errorCode(propose(fontBranch, fontHead, reviewer.client))).toBe("42501");
    expect(await errorCode(propose(fontBranch, base))).toBe("55000");
    expect(await errorCode(propose(fontBranch, fontHead).then(() => undefined))).toBe("ok");
  });

  it("stores the candidate with both parents without moving any branch", async () => {
    await claim(jobId);
    candidate = await uploadFor(jobId, "00000000000000d1");
    const parents = (
      await admin.from("checkpoint_parents").select("parent_id").eq("checkpoint_id", candidate)
    ).data!.map((p) => p.parent_id);
    expect(parents.sort()).toEqual([fontHead, bgHead].sort());
    expect(await head(fontBranch)).toBe(fontHead);
    expect(await head(bgBranch)).toBe(bgHead);
    const { data: c } = await admin
      .from("checkpoints")
      .select("status,proposal_item_id")
      .eq("id", candidate)
      .single();
    expect(c).toEqual({ status: "finalized", proposal_item_id: itemId });
    const { data: item } = await admin.from("proposal_items").select("*").eq("id", itemId).single();
    expect(item).toMatchObject({ status: "ready", candidate_checkpoint_id: candidate });
    const { data: p } = await admin
      .from("proposals")
      .select("status")
      .eq("id", proposalId)
      .single();
    expect(p!.status).toBe("ready");
  });

  it("only approves the exact candidate, and only for editors", async () => {
    expect(
      await errorCode(
        rpc(editor.client, "approve_proposal", {
          p_proposal_id: proposalId,
          p_candidate_checkpoint_id: fontHead,
        }),
      ),
    ).toBe("55000");
    expect(
      await errorCode(
        rpc(reviewer.client, "approve_proposal", {
          p_proposal_id: proposalId,
          p_candidate_checkpoint_id: candidate,
        }),
      ),
    ).toBe("42501");
  });

  it("finalizes the approved candidate on the target branch and records the approval", async () => {
    const approved = await rpc<{ status: string; approved_by: string }>(
      editor.client,
      "approve_proposal",
      { p_proposal_id: proposalId, p_candidate_checkpoint_id: candidate },
    );
    expect(approved).toMatchObject({ status: "finalized", approved_by: editor.id });
    expect(await head(fontBranch)).toBe(candidate);
    expect(await head(bgBranch)).toBe(bgHead);
    const { data: item } = await admin.from("proposal_items").select("*").eq("id", itemId).single();
    expect(item!.status).toBe("finalized");
    expect(item!.outcome).toMatchObject({
      approvedCandidateId: candidate,
      nativeDigest: "00000000000000d1",
      previewDigest: "00000000000000df",
      approvedBy: editor.id,
    });
    // Sources are untouched and still finalized.
    const { data: sources } = await admin
      .from("checkpoints")
      .select("id,status")
      .in("id", [base, fontHead, bgHead]);
    expect(sources!.every((s) => s.status === "finalized")).toBe(true);
    expect(sources).toHaveLength(3);
    fontHead = candidate;
  });

  it("refuses approval when the target branch moved after the candidate was made", async () => {
    const created = await propose();
    await claim(created.job.id);
    const stale = await uploadFor(created.job.id, "00000000000000e1");
    fontHead = await capture(fontBranch, "00000000000000f1");
    expect(
      await errorCode(
        rpc(editor.client, "approve_proposal", {
          p_proposal_id: created.proposal.id,
          p_candidate_checkpoint_id: stale,
        }),
      ),
    ).toBe("55000");
    expect(await head(fontBranch)).toBe(fontHead);

    const rejected = await rpc<{ status: string }>(editor.client, "reject_proposal", {
      p_proposal_id: created.proposal.id,
    });
    expect(rejected.status).toBe("rejected");
  });

  it("marks the proposal failed when the candidate job fails", async () => {
    const created = await propose();
    await claim(created.job.id);
    await rpc(admin, "fail_job", {
      p_session_id: session,
      p_job_id: created.job.id,
      p_error: { code: "APPLICATION_ERROR", message: "font missing" },
      p_retryable: false,
    });
    const { data: p } = await admin
      .from("proposals")
      .select("status,proposal_items(status,outcome)")
      .eq("id", created.proposal.id)
      .single();
    expect(p).toMatchObject({
      status: "failed",
      proposal_items: [{ status: "failed", outcome: { error: { message: "font missing" } } }],
    });
  });
});

describe("known file paths", () => {
  it("remembers every path a document has used", async () => {
    const { data: created } = await editor.client
      .from("assets")
      .insert({
        project_id: projectId,
        application: "photoshop",
        name: "Flyer",
        native_locator: { path: "/tmp/p5/flyer.psd" },
      })
      .select("id,known_paths")
      .single();
    expect(created!.known_paths).toEqual(["/tmp/p5/flyer.psd"]);
    for (const path of ["/tmp/p5/working/1/Flyer - alt.psd", "/tmp/p5/flyer.psd"])
      await admin.from("assets").update({ native_locator: { path } }).eq("id", created!.id);
    const { data } = await admin
      .from("assets")
      .select("known_paths")
      .eq("id", created!.id)
      .single();
    expect(data!.known_paths).toEqual(["/tmp/p5/flyer.psd", "/tmp/p5/working/1/Flyer - alt.psd"]);
  });
});

describe("deleting a document with history", () => {
  it("removes branches, checkpoints, proposals and candidates in one delete", async () => {
    const { error } = await editor.client.from("assets").delete().eq("id", assetId);
    expect(error).toBeNull();
    for (const table of [
      "checkpoints",
      "branches",
      "checkpoint_parents",
      "proposal_items",
      "jobs",
    ]) {
      const { count } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("asset_id", assetId);
      expect({ table, count }).toEqual({ table, count: 0 });
    }
  });
});
