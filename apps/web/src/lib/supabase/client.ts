import { createBrowserClient } from "@supabase/ssr";

/** Browser client. Uses only the publishable key; RLS enforces access. */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured. See docs/setup.md.");
  }
  return createBrowserClient(url, key);
}
