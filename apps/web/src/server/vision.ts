import "server-only";

import { z } from "zod";

import { serverEnv } from "@/lib/env";

const visionHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("vision"),
  version: z.string(),
  authenticated: z.boolean(),
});

export type VisionHealth =
  | { reachable: true; health: z.infer<typeof visionHealthSchema> }
  | { reachable: false; error: string };

/**
 * Calls the vision service with the shared service token. The token lives only
 * on the server; browsers and connector plugins never talk to vision directly.
 */
export async function checkVisionHealth(timeoutMs = 2000): Promise<VisionHealth> {
  const env = serverEnv();
  const headers: HeadersInit = {};
  if (env.VISION_SERVICE_TOKEN) headers.Authorization = `Bearer ${env.VISION_SERVICE_TOKEN}`;

  try {
    const response = await fetch(new URL("/health", env.VISION_SERVICE_URL), {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { reachable: false, error: `HTTP ${response.status}` };
    return { reachable: true, health: visionHealthSchema.parse(await response.json()) };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}
