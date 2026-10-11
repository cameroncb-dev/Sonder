import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Reads the local stack's URL and keys from `supabase status`. Refuses to run
 * against anything but localhost so tests never touch the hosted project.
 */
export default function setup() {
  const repoRoot = path.resolve(import.meta.dirname, "../../../..");
  const output = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const env = Object.fromEntries(
    output
      .split("\n")
      .map((line) => /^([A-Z_]+)="?([^"]*)"?$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  const url = env.API_URL;
  if (!url || !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error(`Integration tests require the local Supabase stack (got ${url ?? "nothing"})`);
  }
  process.env.TEST_SUPABASE_URL = url;
  process.env.TEST_SUPABASE_PUBLISHABLE_KEY = env.PUBLISHABLE_KEY ?? env.ANON_KEY;
  process.env.TEST_SUPABASE_SECRET_KEY = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY;
}
