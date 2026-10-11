/**
 * Verifies Supabase connectivity, private buckets, and project-scoped storage
 * access. Creates throwaway users and a project, and removes them afterwards.
 *
 *   pnpm --filter web verify:supabase
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY from apps/web/.env.local or the environment.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "BLOCKED: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.",
  );
  process.exit(2);
}

const BUCKETS = ["snapshots", "previews", "references"];
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secretKey, noSession);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  check("database/storage reachable with secret key", !bucketError, bucketError?.message);
  for (const id of BUCKETS) {
    const bucket = buckets?.find((b) => b.id === id);
    check(`bucket '${id}' exists and is private`, Boolean(bucket && !bucket.public));
  }

  // Two throwaway users: a project member and an outsider.
  const users: Array<{ id: string; client: SupabaseClient }> = [];
  for (const label of ["member", "outsider"]) {
    const email = `sonder-verify-${label}-${randomUUID()}@example.com`;
    const password = randomUUID();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    check(`create temporary ${label}`, !error, error?.message);
    if (!data?.user) return;
    const client = createClient(url!, publishableKey!, noSession);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    check(`${label} signs in with publishable key`, !signInError, signInError?.message);
    users.push({ id: data.user.id, client });
  }
  const [member, outsider] = users as [(typeof users)[0], (typeof users)[0]];
  let projectId: string | undefined;

  try {
    const { data: project, error: projectError } = await member.client.rpc("create_project", {
      p_name: "verify",
    });
    projectId = (project as { id?: string } | null)?.id;
    check(
      "member creates a project (database reachable)",
      !projectError && !!projectId,
      projectError?.message,
    );
    if (!projectId) return;

    const refPath = `${projectId}/verify-${randomUUID()}.png`;
    const payload = new Blob([`sonder ${new Date().toISOString()}`], { type: "image/png" });
    const { error: uploadError } = await member.client.storage
      .from("references")
      .upload(refPath, payload);
    check("member uploads a private reference", !uploadError, uploadError?.message);

    const { data: downloaded, error: downloadError } = await member.client.storage
      .from("references")
      .download(refPath);
    check(
      "member downloads it",
      !downloadError && (await downloaded!.text()) === (await payload.text()),
      downloadError?.message,
    );

    const { data: outsiderData } = await outsider.client.storage
      .from("references")
      .download(refPath);
    check("outsider download is denied", !outsiderData);

    const { error: snapshotError } = await member.client.storage
      .from("snapshots")
      .upload(`${projectId}/x/${randomUUID()}.psd`, new Blob(["x"]));
    check("clients cannot write snapshots directly", Boolean(snapshotError));

    const anonymous = createClient(url!, publishableKey!, noSession);
    const { data: anonData } = await anonymous.storage.from("references").download(refPath);
    check("anonymous download is denied", !anonData);

    const { data: hidden } = await outsider.client
      .from("projects")
      .select("id")
      .eq("id", projectId);
    check("outsider cannot see the project", (hidden ?? []).length === 0);
  } finally {
    if (projectId) {
      const { data: objects } = await admin.storage.from("references").list(projectId);
      if (objects?.length)
        await admin.storage.from("references").remove(objects.map((o) => `${projectId}/${o.name}`));
      await admin.from("projects").delete().eq("id", projectId);
    }
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  }
}

main()
  .catch((error) => {
    failures++;
    console.error("FAIL ", error);
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed` : "\nAll Supabase checks passed");
    process.exit(failures ? 1 : 0);
  });
