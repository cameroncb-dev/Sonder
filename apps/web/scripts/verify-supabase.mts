/**
 * Verifies Supabase connectivity, private buckets, and authenticated
 * upload/download. Creates a throwaway user and removes it afterwards.
 *
 *   pnpm --filter web verify:supabase
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY from apps/web/.env.local or the environment.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

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

  const email = `sonder-verify-${randomUUID()}@example.com`;
  const password = randomUUID();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  check("create temporary user", !createError, createError?.message);
  if (!created?.user) return;
  const userId = created.user.id;
  const path = `${userId}/verify-${randomUUID()}.txt`;
  const payload = `sonder ${new Date().toISOString()}`;

  try {
    const user = createClient(url!, publishableKey!, noSession);
    const { error: signInError } = await user.auth.signInWithPassword({ email, password });
    check("sign in with publishable key", !signInError, signInError?.message);

    const { error: uploadError } = await user.storage
      .from("snapshots")
      .upload(path, new Blob([payload], { type: "text/plain" }));
    check("authenticated upload to own folder", !uploadError, uploadError?.message);

    const { data: downloaded, error: downloadError } = await user.storage
      .from("snapshots")
      .download(path);
    const text = downloaded ? await downloaded.text() : "";
    check(
      "authenticated download matches upload",
      !downloadError && text === payload,
      downloadError?.message,
    );

    const { error: foreignError } = await user.storage
      .from("snapshots")
      .upload(`${randomUUID()}/intrusion.txt`, new Blob(["x"], { type: "text/plain" }));
    check("upload to another user's folder is denied", Boolean(foreignError));

    const anonymous = createClient(url!, publishableKey!, noSession);
    const { data: anonData } = await anonymous.storage.from("snapshots").download(path);
    check("anonymous download is denied", !anonData);
  } finally {
    await admin.storage.from("snapshots").remove([path]);
    await admin.auth.admin.deleteUser(userId);
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
