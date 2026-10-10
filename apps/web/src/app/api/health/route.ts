import { connection } from "next/server";

import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { llmStatus } from "@/server/llm";
import { checkVisionHealth } from "@/server/vision";

/** Liveness of the web backend plus reachability of its dependencies. */
export async function GET() {
  await connection();
  const env = serverEnv();
  const vision = await checkVisionHealth();

  return Response.json({
    status: "ok",
    service: "web",
    vision,
    supabase: { configured: isSupabaseConfigured(env) },
    llm: llmStatus(env),
  });
}
