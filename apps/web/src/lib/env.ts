import { z } from "zod";

/**
 * Server-only environment. Every integration is optional at boot so the app
 * can start before credentials exist; callers check `isConfigured` helpers
 * and report the integration as unavailable instead of failing.
 */
const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),

  VISION_SERVICE_URL: z.url().default("http://127.0.0.1:8000"),
  VISION_SERVICE_TOKEN: z.string().min(16).optional(),

  LLM_PROVIDER: z.enum(["none", "anthropic"]).default("none"),
  LLM_MODEL: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Treat empty strings from .env files as unset. */
function readRawEnv(source: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(readRawEnv(source));
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export function isSupabaseConfigured(env: ServerEnv = serverEnv()): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
