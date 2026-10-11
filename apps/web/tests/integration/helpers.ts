import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export function adminClient(): SupabaseClient {
  return createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SECRET_KEY!,
    noSession,
  );
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

export async function createUser(admin: SupabaseClient, label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const client = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_PUBLISHABLE_KEY!,
    noSession,
  );
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

/** Creates an active connector session directly (pairing is tested through the API). */
export async function createSession(
  admin: SupabaseClient,
  userId: string,
  overrides: { application?: string; operations?: string[]; expiresInSeconds?: number } = {},
) {
  const { data, error } = await admin
    .from("connector_sessions")
    .insert({
      user_id: userId,
      application: overrides.application ?? "photoshop",
      connector_version: "0.3.0",
      capabilities: { operations: overrides.operations ?? ["captureCheckpoint", "readProperties"] },
      status: "active",
      token_hash: randomUUID(),
      expires_at: new Date(Date.now() + (overrides.expiresInSeconds ?? 3600) * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export const opId = () => `op-${randomUUID()}`;

/** A manifest whose file digests match the values passed to record_checkpoint_file. */
export function manifest(nativeDigest = "0000000000000001", previewDigest = "0000000000000002") {
  return {
    schemaVersion: 1,
    files: {
      native: {
        name: "c.psd",
        mediaType: "image/vnd.adobe.photoshop",
        bytes: 10,
        digest: nativeDigest,
      },
      preview: { name: "c.png", mediaType: "image/png", bytes: 10, digest: previewDigest },
    },
  };
}
