import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { adminClient, createSession, createUser, manifest, opId, type TestUser } from "./helpers";

let admin: SupabaseClient;
let editor: TestUser;
let reviewer: TestUser;
let projectId: string;
let assetId: string;
let session: string;
let head: string;
let mainId: string;

async function rpc<T = Record<string, unknown>>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw Object.assign(new Error(`${fn}: ${error.message}`), { code: error.code });
  return data as T;
}
const errorCode = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code,
  );

async function runJob(jobId: string, digest: string) {
  let leased = await rpc<{ id: string | null }>(admin, "claim_job", { p_session_id: session });
  while (leased.id && leased.id !== jobId)
    leased = await rpc(admin, "claim_job", { p_session_id: session });
  const c = await rpc<{ id: string }>(admin, "begin_checkpoint", {
    p_session_id: session,
    p_job_id: jobId,
    p_manifest: manifest(digest, `${digest.slice(0, 15)}f`),
  });
  for (const [kind, d] of [
    ["native", digest],
    ["preview", `${digest.slice(0, 15)}f`],
  ])
    await rpc(admin, "record_checkpoint_file", {
      p_session_id: session,
      p_checkpoint_id: c.id,
      p_kind: kind,
      p_path: `${projectId}/${assetId}/${c.id}/${kind}`,
      p_bytes: 10,
      p_digest: d,
    });
  await rpc(admin, "finalize_checkpoint", { p_session_id: session, p_checkpoint_id: c.id });
  return c.id;
}

const suggest = (client = editor.client) =>
  rpc<{ proposal: { id: string }; job: { id: string; params: Record<string, unknown> } }>(
    client,
    "create_suggestion_proposal",
    {
      p_project_id: projectId,
      p_asset_id: assetId,
      p_request: { title: "Editorial", rationale: "Serif", changes: [] },
      p_job_params: {
        targetCheckpoint: { id: head, manifest: manifest() },
        changeSet: { mappings: [], changes: [] },
      },
    },
  );

beforeAll(async () => {
  admin = adminClient();
  editor = await createUser(admin, "p8-editor");
  reviewer = await createUser(admin, "p8-reviewer");
  projectId = (await rpc<{ id: string }>(editor.client, "create_project", { p_name: "Phase 8" }))
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
      native_locator: { path: "/tmp/p8.psd" },
    })
    .select("id")
    .single();
  assetId = data!.id;
  session = await createSession(admin, editor.id, {
    operations: ["captureCheckpoint", "createCandidate"],
  });
  const job = await rpc<{ id: string }>(editor.client, "create_job", {
    p_project_id: projectId,
    p_asset_id: assetId,
    p_operation: "captureCheckpoint",
    p_operation_id: opId(),
    p_params: {},
    p_requires_asset_session: false,
  });
  head = await runJob(job.id, "00000000000000a8");
  mainId = (await admin.from("branches").select("id").eq("asset_id", assetId).single()).data!.id;
});

describe("suggested branches", () => {
  it("keeps a tried suggestion as a new branch without moving the current one", async () => {
    expect(await errorCode(suggest(reviewer.client))).toBe("42501");
    const created = await suggest();
    expect(created.job.params).toMatchObject({
      parentIds: [head],
      proposalId: created.proposal.id,
    });
    const candidate = await runJob(created.job.id, "00000000000000b8");
    expect(
      (await admin.from("proposals").select("status").eq("id", created.proposal.id).single()).data!
        .status,
    ).toBe("ready");

    expect(
      await errorCode(
        rpc(editor.client, "keep_suggestion", {
          p_proposal_id: created.proposal.id,
          p_candidate_checkpoint_id: head,
          p_branch_name: "editorial",
        }),
      ),
    ).toBe("55000");
    const kept = await rpc<{
      branch: { name: string; head_checkpoint_id: string };
      proposal: { status: string };
    }>(editor.client, "keep_suggestion", {
      p_proposal_id: created.proposal.id,
      p_candidate_checkpoint_id: candidate,
      p_branch_name: "editorial",
    });
    expect(kept.branch).toMatchObject({ name: "editorial", head_checkpoint_id: candidate });
    expect(kept.proposal.status).toBe("finalized");
    expect(
      (await admin.from("branches").select("head_checkpoint_id").eq("id", mainId).single()).data!
        .head_checkpoint_id,
    ).toBe(head);
  });

  it("refuses a branch name that's taken and suggestions from other documents' versions", async () => {
    const created = await suggest();
    const candidate = await runJob(created.job.id, "00000000000000c8");
    expect(
      await errorCode(
        rpc(editor.client, "keep_suggestion", {
          p_proposal_id: created.proposal.id,
          p_candidate_checkpoint_id: candidate,
          p_branch_name: "editorial",
        }),
      ),
    ).toBe("23505");
    const { data: other } = await editor.client
      .from("assets")
      .insert({
        project_id: projectId,
        application: "photoshop",
        name: "Other",
        native_locator: { path: "/tmp/p8b.psd" },
      })
      .select("id")
      .single();
    expect(
      await errorCode(
        rpc(editor.client, "create_suggestion_proposal", {
          p_project_id: projectId,
          p_asset_id: other!.id,
          p_request: {},
          p_job_params: { targetCheckpoint: { id: head } },
        }),
      ),
    ).toBe("23503");
  });
});
