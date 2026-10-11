import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { adminClient, createSession, createUser, manifest, opId, type TestUser } from "./helpers";

let admin: SupabaseClient;
let owner: TestUser, editor: TestUser, reviewer: TestUser, outsider: TestUser;
let projectId: string;
let assetId: string;
let otherAssetId: string;
const docPath = `/tmp/sonder-test-${Date.now()}/poster.psd`;

async function rpc<T = Record<string, unknown>>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

async function createJob(
  client: SupabaseClient,
  options: Partial<{
    asset: string;
    operation: string;
    maxAttempts: number;
    operationId: string;
  }> = {},
) {
  return rpc<{ id: string; operation_id: string; status: string }>(client, "create_job", {
    p_project_id: projectId,
    p_asset_id: options.asset ?? assetId,
    p_operation: options.operation ?? "captureCheckpoint",
    p_operation_id: options.operationId ?? opId(),
    p_max_attempts: options.maxAttempts ?? 3,
  });
}

const claim = (session: string) =>
  rpc<{ id: string | null; attempts: number; status: string }>(admin, "claim_job", {
    p_session_id: session,
  });

async function expireLease(jobId: string) {
  const { error } = await admin
    .from("jobs")
    .update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("id", jobId);
  if (error) throw error;
}

async function events(jobId: string) {
  const { data } = await admin
    .from("job_events")
    .select("from_status,to_status,attempt,detail")
    .eq("job_id", jobId)
    .order("id");
  return data ?? [];
}

/** Drives one checkpoint through begin → files → finalize for a leased job. */
async function storeCheckpoint(session: string, jobId: string, finalize = true) {
  const checkpoint = await rpc<{ id: string }>(admin, "begin_checkpoint", {
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
      p_checkpoint_id: checkpoint.id,
      p_kind: kind,
      p_path: `${projectId}/${assetId}/${checkpoint.id}/${kind}`,
      p_bytes: 10,
      p_digest: digest,
    });
  }
  return finalize
    ? rpc<{ id: string; status: string }>(admin, "finalize_checkpoint", {
        p_session_id: session,
        p_checkpoint_id: checkpoint.id,
      })
    : checkpoint;
}

beforeAll(async () => {
  admin = adminClient();
  [owner, editor, reviewer, outsider] = await Promise.all(
    ["owner", "editor", "reviewer", "outsider"].map((label) => createUser(admin, label)),
  );
  const project = await rpc<{ id: string }>(owner.client, "create_project", {
    p_name: "Integration",
  });
  projectId = project.id;
  const { error } = await owner.client.from("project_members").insert([
    { project_id: projectId, user_id: editor.id, role: "editor" },
    { project_id: projectId, user_id: reviewer.id, role: "reviewer" },
  ]);
  if (error) throw error;
  const { data: assets, error: assetError } = await editor.client
    .from("assets")
    .insert([
      {
        project_id: projectId,
        application: "photoshop",
        name: "Poster A",
        native_locator: { path: docPath },
      },
      {
        project_id: projectId,
        application: "photoshop",
        name: "Poster B",
        native_locator: { path: `${docPath}.b` },
      },
    ])
    .select("id");
  if (assetError) throw assetError;
  [assetId, otherAssetId] = assets!.map((a) => a.id as string) as [string, string];
});

describe("permissions", () => {
  it("hides projects and assets from non-members", async () => {
    expect((await outsider.client.from("projects").select("id").eq("id", projectId)).data).toEqual(
      [],
    );
    expect(
      (await outsider.client.from("assets").select("id").eq("project_id", projectId)).data,
    ).toEqual([]);
    expect(
      (await reviewer.client.from("assets").select("id").eq("project_id", projectId)).data,
    ).toHaveLength(2);
  });

  it("lets reviewers read but not write", async () => {
    const { error } = await reviewer.client
      .from("assets")
      .insert({ project_id: projectId, application: "photoshop", name: "Nope" });
    expect(error).not.toBeNull();
    await expect(createJob(reviewer.client)).rejects.toThrow(/owners and editors/);
    const comment = await reviewer.client.from("comments").insert({
      project_id: projectId,
      target_type: "project",
      target_id: projectId,
      body: "Looks good",
      created_by: reviewer.id,
    });
    expect(comment.error).toBeNull();
  });

  it("prevents outsiders from joining or creating jobs", async () => {
    const { error } = await outsider.client
      .from("project_members")
      .insert({ project_id: projectId, user_id: outsider.id, role: "owner" });
    expect(error).not.toBeNull();
    await expect(createJob(outsider.client)).rejects.toThrow();
  });

  it("keeps connector functions and session secrets away from clients", async () => {
    const { error } = await editor.client.rpc("claim_job", {
      p_session_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
    const session = await createSession(admin, editor.id);
    const secret = await editor.client
      .from("connector_sessions")
      .select("token_hash")
      .eq("id", session);
    expect(secret.error).not.toBeNull();
    const visible = await editor.client
      .from("connector_sessions")
      .select("id,status")
      .eq("id", session);
    expect(visible.data).toHaveLength(1);
  });
});

describe("jobs", () => {
  it("creates jobs idempotently by operation id", async () => {
    const operationId = opId();
    const first = await createJob(editor.client, { operationId });
    const second = await createJob(editor.client, { operationId });
    expect(second.id).toBe(first.id);
    await expect(createJob(editor.client, { operationId, asset: otherAssetId })).rejects.toThrow(
      /different job/,
    );
  });

  it("routes jobs only to compatible sessions with the asset open", async () => {
    const job = await createJob(editor.client);
    const editorSession = await createSession(admin, editor.id);
    const illustrator = await createSession(admin, editor.id, { application: "illustrator" });
    const reviewerSession = await createSession(admin, reviewer.id);
    const outsiderSession = await createSession(admin, outsider.id);
    const limited = await createSession(admin, editor.id, { operations: ["readProperties"] });

    // Not reporting the document yet: no claim.
    expect((await claim(editorSession)).id).toBeNull();

    for (const s of [editorSession, reviewerSession, outsiderSession, limited]) {
      await rpc(admin, "report_session_assets", { p_session_id: s, p_paths: [docPath] });
    }
    const reported = await rpc<Array<{ asset_id: string }>>(admin, "report_session_assets", {
      p_session_id: outsiderSession,
      p_paths: [docPath],
    });
    expect(reported).toEqual([]);

    expect((await claim(illustrator)).id).toBeNull();
    expect((await claim(reviewerSession)).id).toBeNull();
    expect((await claim(outsiderSession)).id).toBeNull();
    expect((await claim(limited)).id).toBeNull();

    // Older queued jobs from earlier tests are claimed first (oldest-first order).
    let leased = await claim(editorSession);
    while (leased.id && leased.id !== job.id) leased = await claim(editorSession);
    expect(leased).toMatchObject({ id: job.id, status: "leased", attempts: 1 });
    expect((await claim(editorSession)).id).toBeNull();
  });

  it("does not duplicate checkpoints on repeated delivery and hides incomplete ones", async () => {
    const session = await createSession(admin, editor.id);
    await rpc(admin, "report_session_assets", { p_session_id: session, p_paths: [docPath] });
    const job = await createJob(editor.client);
    let leased = await claim(session);
    while (leased.id && leased.id !== job.id) leased = await claim(session);
    expect(leased.id).toBe(job.id);

    const pending = await storeCheckpoint(session, job.id, false);
    const visibleWhilePending = await reviewer.client
      .from("checkpoints")
      .select("id")
      .eq("id", pending.id);
    expect(visibleWhilePending.data).toEqual([]);
    await expect(
      rpc(admin, "begin_checkpoint", {
        p_session_id: session,
        p_job_id: job.id,
        p_manifest: manifest(),
      }),
    ).resolves.toMatchObject({ id: pending.id });

    const finalized = await rpc<{ id: string; status: string }>(admin, "finalize_checkpoint", {
      p_session_id: session,
      p_checkpoint_id: pending.id,
    });
    expect(finalized).toMatchObject({ id: pending.id, status: "finalized" });
    // Repeated finalize and repeated completion are no-ops.
    await rpc(admin, "finalize_checkpoint", { p_session_id: session, p_checkpoint_id: pending.id });
    await rpc(admin, "complete_job", {
      p_session_id: session,
      p_job_id: job.id,
      p_result: { checkpointId: pending.id },
    });

    const { data: rows } = await admin
      .from("checkpoints")
      .select("id")
      .eq("operation_id", job.operation_id);
    expect(rows).toHaveLength(1);
    expect(
      (await reviewer.client.from("checkpoints").select("id").eq("id", pending.id)).data,
    ).toHaveLength(1);
    const { data: jobRow } = await admin
      .from("jobs")
      .select("status,result")
      .eq("id", job.id)
      .single();
    expect(jobRow).toMatchObject({ status: "succeeded", result: { checkpointId: pending.id } });
    expect((await events(job.id)).map((e) => `${e.from_status}->${e.to_status}`)).toEqual([
      "null->queued",
      "queued->leased",
      "leased->succeeded",
    ]);
  });

  it("refuses to finalize checkpoints whose files are missing or mismatched", async () => {
    const session = await createSession(admin, editor.id);
    await rpc(admin, "report_session_assets", { p_session_id: session, p_paths: [docPath] });
    const job = await createJob(editor.client);
    let leased = await claim(session);
    while (leased.id && leased.id !== job.id) leased = await claim(session);
    const checkpoint = await rpc<{ id: string }>(admin, "begin_checkpoint", {
      p_session_id: session,
      p_job_id: job.id,
      p_manifest: manifest(),
    });
    await expect(
      rpc(admin, "finalize_checkpoint", { p_session_id: session, p_checkpoint_id: checkpoint.id }),
    ).rejects.toThrow(/missing files/);
    for (const kind of ["native", "preview"]) {
      await rpc(admin, "record_checkpoint_file", {
        p_session_id: session,
        p_checkpoint_id: checkpoint.id,
        p_kind: kind,
        p_path: `${projectId}/x/${kind}`,
        p_bytes: 10,
        p_digest: "ffffffffffffffff",
      });
    }
    await expect(
      rpc(admin, "finalize_checkpoint", { p_session_id: session, p_checkpoint_id: checkpoint.id }),
    ).rejects.toThrow(/do not match/);
  });

  it("re-queues expired leases with bounded retries", async () => {
    const session = await createSession(admin, editor.id);
    await rpc(admin, "report_session_assets", { p_session_id: session, p_paths: [docPath] });
    const job = await createJob(editor.client, { maxAttempts: 2 });
    let leased = await claim(session);
    while (leased.id && leased.id !== job.id) leased = await claim(session);

    await expireLease(job.id);
    const retried = await claim(session);
    expect(retried).toMatchObject({ id: job.id, attempts: 2 });

    await expireLease(job.id);
    await rpc(admin, "reconcile_expired_jobs", {});
    const { data } = await admin.from("jobs").select("status,error").eq("id", job.id).single();
    expect(data).toMatchObject({
      status: "failed",
      error: { code: "LEASE_EXPIRED", reconciled: true },
    });
    expect((await events(job.id)).map((e) => e.to_status)).toEqual([
      "queued",
      "leased",
      "queued",
      "leased",
      "failed",
    ]);
  });

  it("reconciles an uncertain job from its recorded side effect instead of re-running it", async () => {
    const session = await createSession(admin, editor.id);
    await rpc(admin, "report_session_assets", { p_session_id: session, p_paths: [docPath] });
    const job = await createJob(editor.client);
    let leased = await claim(session);
    while (leased.id && leased.id !== job.id) leased = await claim(session);
    const checkpoint = await storeCheckpoint(session, job.id, false);
    // The connector crashed after its files were stored; finalize happened but the
    // lease expired before the job was marked complete.
    await admin
      .from("checkpoints")
      .update({ status: "finalized", finalized_at: new Date().toISOString() })
      .eq("id", checkpoint.id);
    await expireLease(job.id);
    await rpc(admin, "reconcile_expired_jobs", {});
    const { data } = await admin
      .from("jobs")
      .select("status,result,attempts")
      .eq("id", job.id)
      .single();
    expect(data).toMatchObject({
      status: "succeeded",
      attempts: 1,
      result: { checkpointId: checkpoint.id, reconciled: true },
    });
  });

  it("rejects invalid transitions, stale leases and expired sessions", async () => {
    const session = await createSession(admin, editor.id);
    const other = await createSession(admin, editor.id);
    await rpc(admin, "report_session_assets", { p_session_id: session, p_paths: [docPath] });
    const job = await createJob(editor.client);
    let leased = await claim(session);
    while (leased.id && leased.id !== job.id) leased = await claim(session);

    await expect(
      rpc(admin, "complete_job", { p_session_id: other, p_job_id: job.id, p_result: {} }),
    ).rejects.toThrow(/stale lease/);
    await rpc(admin, "complete_job", {
      p_session_id: session,
      p_job_id: job.id,
      p_result: { ok: true },
    });
    const { error } = await admin.from("jobs").update({ status: "queued" }).eq("id", job.id);
    expect(error?.message).toMatch(/invalid job transition|terminal/);

    const expired = await createSession(admin, editor.id, { expiresInSeconds: -60 });
    await expect(claim(expired)).rejects.toThrow(/not active/);
  });
});

describe("history constraints", () => {
  let checkpointA: string;
  let checkpointB: string;
  let pendingA: string;

  beforeAll(async () => {
    const session = await createSession(admin, editor.id);
    await rpc(admin, "report_session_assets", {
      p_session_id: session,
      p_paths: [docPath, `${docPath}.b`],
    });
    const ids: string[] = [];
    for (const asset of [assetId, otherAssetId]) {
      const job = await createJob(editor.client, { asset });
      let leased = await claim(session);
      while (leased.id && leased.id !== job.id) leased = await claim(session);
      const c = await rpc<{ id: string }>(admin, "begin_checkpoint", {
        p_session_id: session,
        p_job_id: job.id,
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
      await rpc(admin, "finalize_checkpoint", { p_session_id: session, p_checkpoint_id: c.id });
      ids.push(c.id);
    }
    [checkpointA, checkpointB] = ids as [string, string];
    const job = await createJob(editor.client);
    let leased = await claim(session);
    while (leased.id && leased.id !== job.id) leased = await claim(session);
    pendingA = (
      await rpc<{ id: string }>(admin, "begin_checkpoint", {
        p_session_id: session,
        p_job_id: job.id,
        p_manifest: manifest(),
      })
    ).id;
  });

  it("keeps finalized checkpoints immutable", async () => {
    const { error } = await admin
      .from("checkpoints")
      .update({ message: "rewrite" })
      .eq("id", checkpointA);
    expect(error?.message).toMatch(/immutable/);
  });

  it("only lets branches point at finalized checkpoints of their own asset", async () => {
    const wrongAsset = await editor.client
      .from("branches")
      .insert({ asset_id: assetId, name: "x", head_checkpoint_id: checkpointB });
    expect(wrongAsset.error).not.toBeNull();
    const pending = await admin
      .from("branches")
      .insert({ asset_id: assetId, name: "p", head_checkpoint_id: pendingA });
    expect(pending.error?.message).toMatch(/not finalized/);
    const ok = await editor.client
      .from("branches")
      .insert({ asset_id: assetId, name: "release", head_checkpoint_id: checkpointA });
    expect(ok.error).toBeNull();
  });

  it("rejects parent links across assets", async () => {
    const { error } = await admin
      .from("checkpoint_parents")
      .insert({ asset_id: assetId, checkpoint_id: checkpointA, parent_id: checkpointB });
    expect(error).not.toBeNull();
  });

  it("pins direction entries to exact checkpoints", async () => {
    const { data: direction } = await editor.client
      .from("directions")
      .insert({ project_id: projectId, name: "Vintage" })
      .select("id")
      .single();
    const insert = await editor.client
      .from("direction_entries")
      .insert({ direction_id: direction!.id, asset_id: assetId, checkpoint_id: checkpointA });
    expect(insert.error).toBeNull();
    const update = await admin
      .from("direction_entries")
      .update({ checkpoint_id: checkpointA })
      .eq("direction_id", direction!.id);
    expect(update.error?.message).toMatch(/immutable/);
  });
});

describe("storage", () => {
  it("restricts artifacts to project members", async () => {
    const path = `${projectId}/${assetId}/manual/snapshot.psd`;
    const upload = await admin.storage
      .from("snapshots")
      .upload(path, new Blob(["psd"]), { contentType: "image/vnd.adobe.photoshop" });
    expect(upload.error).toBeNull();

    expect((await reviewer.client.storage.from("snapshots").download(path)).error).toBeNull();
    expect((await outsider.client.storage.from("snapshots").download(path)).data).toBeNull();

    const editorSnapshot = await editor.client.storage
      .from("snapshots")
      .upload(`${projectId}/${assetId}/x/y.psd`, new Blob(["x"]));
    expect(editorSnapshot.error).not.toBeNull();
    const reference = await editor.client.storage
      .from("references")
      .upload(`${projectId}/ref.png`, new Blob(["png"], { type: "image/png" }));
    expect(reference.error).toBeNull();
    const outsiderRef = await outsider.client.storage
      .from("references")
      .upload(`${projectId}/evil.png`, new Blob(["png"], { type: "image/png" }));
    expect(outsiderRef.error).not.toBeNull();
    const reviewerRef = await reviewer.client.storage
      .from("references")
      .upload(`${projectId}/r.png`, new Blob(["png"], { type: "image/png" }));
    expect(reviewerRef.error).not.toBeNull();
  });
});
