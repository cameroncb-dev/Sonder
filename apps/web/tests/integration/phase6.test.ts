import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { adminClient, createSession, createUser, manifest, opId, type TestUser } from "./helpers";

let admin: SupabaseClient;
let editor: TestUser;
let projectId: string;
let session: string;
const assets: string[] = [];
const heads: string[] = [];

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

async function claim(jobId: string) {
  let leased = await rpc<{ id: string | null }>(admin, "claim_job", { p_session_id: session });
  while (leased.id && leased.id !== jobId)
    leased = await rpc(admin, "claim_job", { p_session_id: session });
  expect(leased.id).toBe(jobId);
}

async function upload(jobId: string, assetId: string, digest: string) {
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

const jobFor = async (itemId: string) =>
  (
    await admin
      .from("jobs")
      .select("id,params")
      .eq("params->>proposalItemId", itemId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
  ).data!;
const status = async (proposalId: string) =>
  (await admin.from("proposals").select("status").eq("id", proposalId).single()).data!.status;
const head = async (assetId: string) =>
  (
    await admin
      .from("assets")
      .select("branches!assets_active_branch_fk(head_checkpoint_id)")
      .eq("id", assetId)
      .single()
  ).data!.branches as unknown as { head_checkpoint_id: string };

const jobParams = (i: number) => ({
  targetCheckpoint: { id: heads[i], manifest: manifest() },
  changeSet: { mappings: [], changes: [] },
});

beforeAll(async () => {
  admin = adminClient();
  editor = await createUser(admin, "p6-editor");
  projectId = (await rpc<{ id: string }>(editor.client, "create_project", { p_name: "Phase 6" }))
    .id;
  session = await createSession(admin, editor.id, {
    operations: ["captureCheckpoint", "createCandidate"],
  });
  for (const name of ["poster", "flyer", "banner"]) {
    const { data } = await editor.client
      .from("assets")
      .insert({
        project_id: projectId,
        application: "photoshop",
        name,
        native_locator: { path: `/tmp/p6/${name}.psd` },
      })
      .select("id")
      .single();
    assets.push(data!.id);
    const job = await rpc<{ id: string }>(editor.client, "create_job", {
      p_project_id: projectId,
      p_asset_id: data!.id,
      p_operation: "captureCheckpoint",
      p_operation_id: opId(),
      p_params: {},
      p_requires_asset_session: false,
    });
    await claim(job.id);
    heads.push(await upload(job.id, data!.id, `0000000000000${assets.length}a1`));
  }
});

describe("coordinated theme updates", () => {
  let proposalId: string;
  let posterItem: string;
  let flyerItem: string;

  it("creates one candidate job per included asset and records exclusions", async () => {
    const created = await rpc<{
      proposal: { id: string; status: string };
      items: Array<{ id: string; asset_id: string; status: string; outcome: unknown }>;
    }>(editor.client, "create_coordinated_proposal", {
      p_project_id: projectId,
      p_request: { themeId: "t" },
      p_items: [
        { assetId: assets[0], include: true, jobParams: jobParams(0) },
        { assetId: assets[1], include: true, jobParams: jobParams(1) },
        { assetId: assets[2], include: false, reason: "Not RGB" },
      ],
    });
    proposalId = created.proposal.id;
    expect(created.proposal.status).toBe("preparing");
    [posterItem, flyerItem] = created.items.map((i) => i.id) as [string, string];
    expect(created.items.map((i) => i.status)).toEqual(["running", "running", "excluded"]);
    expect(created.items[2]!.outcome).toEqual({ reason: "Not RGB" });
    const job = await jobFor(posterItem);
    expect(job.params).toMatchObject({
      proposalId,
      proposalItemId: posterItem,
      parentIds: [heads[0]],
    });
  });

  it("never shows a partial result as complete", async () => {
    const posterJob = await jobFor(posterItem);
    await claim(posterJob.id);
    await upload(posterJob.id, assets[0]!, "00000000000000b1");
    expect(await status(proposalId)).toBe("preparing"); // the flyer is still running

    const flyerJob = await jobFor(flyerItem);
    await claim(flyerJob.id);
    await rpc(admin, "fail_job", {
      p_session_id: session,
      p_job_id: flyerJob.id,
      p_error: { code: "APPLICATION_ERROR", message: "layer locked" },
      p_retryable: false,
    });
    expect(await status(proposalId)).toBe("partially_failed");
  });

  it("finalizes approved items on their own branch and keeps the rest open", async () => {
    const { data: poster } = await admin
      .from("proposal_items")
      .select("candidate_checkpoint_id")
      .eq("id", posterItem)
      .single();
    const result = await rpc<{ proposal: { status: string }; items: Array<{ status: string }> }>(
      editor.client,
      "approve_proposal_items",
      {
        p_proposal_id: proposalId,
        p_items: [{ itemId: posterItem, candidateCheckpointId: poster!.candidate_checkpoint_id }],
      },
    );
    expect(result.items).toEqual([{ itemId: posterItem, status: "finalized" }]);
    expect(result.proposal.status).toBe("partially_failed");
    expect((await head(assets[0]!)).head_checkpoint_id).toBe(poster!.candidate_checkpoint_id);
    expect((await head(assets[1]!)).head_checkpoint_id).toBe(heads[1]);
  });

  it("retries a failed item on its own until the update is complete", async () => {
    await rpc(editor.client, "retry_proposal_item", {
      p_item_id: flyerItem,
      p_job_params: jobParams(1),
    });
    expect(await status(proposalId)).toBe("preparing");
    const retry = await jobFor(flyerItem);
    await claim(retry.id);
    const candidate = await upload(retry.id, assets[1]!, "00000000000000c1");
    expect(await status(proposalId)).toBe("ready");

    const result = await rpc<{ proposal: { status: string } }>(
      editor.client,
      "approve_proposal_items",
      {
        p_proposal_id: proposalId,
        p_items: [{ itemId: flyerItem, candidateCheckpointId: candidate }],
      },
    );
    expect(result.proposal.status).toBe("finalized");
    expect((await head(assets[1]!)).head_checkpoint_id).toBe(candidate);
  });

  it("fails only the item whose branch moved, and refuses stale candidates", async () => {
    heads[2] = (await head(assets[2]!)).head_checkpoint_id;
    heads[0] = (await head(assets[0]!)).head_checkpoint_id;
    const created = await rpc<{ proposal: { id: string }; items: Array<{ id: string }> }>(
      editor.client,
      "create_coordinated_proposal",
      {
        p_project_id: projectId,
        p_request: { themeId: "t" },
        p_items: [
          { assetId: assets[0], include: true, jobParams: jobParams(0) },
          { assetId: assets[2], include: true, jobParams: jobParams(2) },
        ],
      },
    );
    const candidates: string[] = [];
    for (const [i, item] of created.items.entries()) {
      const job = await jobFor(item.id);
      await claim(job.id);
      candidates.push(await upload(job.id, assets[i === 0 ? 0 : 2]!, `00000000000000d${i}`));
    }
    // The banner's branch moves after its candidate was made (someone captured).
    const capture = await rpc<{ id: string }>(editor.client, "create_job", {
      p_project_id: projectId,
      p_asset_id: assets[2],
      p_operation: "captureCheckpoint",
      p_operation_id: opId(),
      p_params: {},
      p_requires_asset_session: false,
    });
    await claim(capture.id);
    const moved = await upload(capture.id, assets[2]!, "00000000000000e1");
    const { data: branch } = await admin
      .from("assets")
      .select("active_branch_id")
      .eq("id", assets[2])
      .single();
    await admin
      .from("branches")
      .update({ head_checkpoint_id: moved })
      .eq("id", branch!.active_branch_id);

    expect(
      await errorCode(
        rpc(editor.client, "approve_proposal_items", {
          p_proposal_id: created.proposal.id,
          p_items: [{ itemId: created.items[0]!.id, candidateCheckpointId: heads[0] }],
        }),
      ),
    ).toBe("55000");
    const result = await rpc<{ proposal: { status: string }; items: Array<{ status: string }> }>(
      editor.client,
      "approve_proposal_items",
      {
        p_proposal_id: created.proposal.id,
        p_items: created.items.map((item, i) => ({
          itemId: item.id,
          candidateCheckpointId: candidates[i],
        })),
      },
    );
    expect(result.items.map((i) => i.status)).toEqual(["finalized", "failed"]);
    expect(result.proposal.status).toBe("partially_failed");
    expect((await head(assets[2]!)).head_checkpoint_id).toBe(moved);
  });
});

describe("directions", () => {
  let directionId: string;
  let pinned: string[];

  it("pins exact versions that stay put when branches move", async () => {
    pinned = await Promise.all(
      assets.slice(0, 2).map(async (id) => (await head(id)).head_checkpoint_id),
    );
    const d = await rpc<{ id: string }>(editor.client, "create_direction", {
      p_project_id: projectId,
      p_name: "Bold launch",
      p_description: "",
      p_entries: assets.slice(0, 2).map((assetId, i) => ({ assetId, checkpointId: pinned[i] })),
    });
    directionId = d.id;

    // The poster moves on.
    const job = await rpc<{ id: string }>(editor.client, "create_job", {
      p_project_id: projectId,
      p_asset_id: assets[0],
      p_operation: "captureCheckpoint",
      p_operation_id: opId(),
      p_params: {},
      p_requires_asset_session: false,
    });
    await claim(job.id);
    const newer = await upload(job.id, assets[0]!, "00000000000000f1");
    const { data: a } = await admin
      .from("assets")
      .select("active_branch_id")
      .eq("id", assets[0])
      .single();
    await admin
      .from("branches")
      .update({ head_checkpoint_id: newer })
      .eq("id", a!.active_branch_id);

    const { data: entries } = await editor.client
      .from("direction_entries")
      .select("asset_id,checkpoint_id")
      .eq("direction_id", directionId);
    expect(entries!.map((e) => e.checkpoint_id).sort()).toEqual([...pinned].sort());
  });

  it("refuses edits to entries and unapproved candidates", async () => {
    const edit = await editor.client
      .from("direction_entries")
      .update({ checkpoint_id: pinned[1] })
      .eq("direction_id", directionId)
      .eq("asset_id", assets[0]!);
    // Row security has no update policy for entries, so the edit changes nothing.
    expect(edit.data).toBeNull();
    const { data: unchanged } = await admin
      .from("direction_entries")
      .select("checkpoint_id")
      .eq("direction_id", directionId)
      .eq("asset_id", assets[0]!)
      .single();
    expect(unchanged!.checkpoint_id).toBe(pinned[0]);

    // A theme candidate that was never approved (built above, then left ready).
    const created = await rpc<{ items: Array<{ id: string }> }>(
      editor.client,
      "create_coordinated_proposal",
      {
        p_project_id: projectId,
        p_request: { themeId: "t" },
        p_items: [
          {
            assetId: assets[1],
            include: true,
            jobParams: {
              targetCheckpoint: {
                id: (await head(assets[1]!)).head_checkpoint_id,
                manifest: manifest(),
              },
              changeSet: { mappings: [], changes: [] },
            },
          },
        ],
      },
    );
    const job = await jobFor(created.items[0]!.id);
    await claim(job.id);
    const candidate = await upload(job.id, assets[1]!, "00000000000000f2");
    expect(
      await errorCode(
        rpc(editor.client, "create_direction", {
          p_project_id: projectId,
          p_name: "Unapproved",
          p_description: "",
          p_entries: [{ assetId: assets[1], checkpointId: candidate }],
        }),
      ),
    ).toBe("23503");
  });

  it("drops only a deleted document's entry", async () => {
    await editor.client.from("assets").delete().eq("id", assets[1]!);
    const { data: entries } = await admin
      .from("direction_entries")
      .select("asset_id")
      .eq("direction_id", directionId);
    expect(entries).toEqual([{ asset_id: assets[0] }]);
  });
});
