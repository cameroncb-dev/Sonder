import { describe, expect, it } from "vitest";

import { isSupabaseConfigured, parseServerEnv } from "./env";

describe("parseServerEnv", () => {
  it("boots with no integrations configured", () => {
    const env = parseServerEnv({});
    expect(env.LLM_PROVIDER).toBe("none");
    expect(env.VISION_SERVICE_URL).toBe("http://127.0.0.1:8000");
    expect(isSupabaseConfigured(env)).toBe(false);
  });

  it("treats empty strings as unset", () => {
    const env = parseServerEnv({ SUPABASE_SECRET_KEY: "", NEXT_PUBLIC_SUPABASE_URL: "" });
    expect(env.SUPABASE_SECRET_KEY).toBeUndefined();
  });

  it("rejects a malformed Supabase URL", () => {
    expect(() => parseServerEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toThrow();
  });

  it("rejects a short vision token", () => {
    expect(() => parseServerEnv({ VISION_SERVICE_TOKEN: "short" })).toThrow();
  });
});
