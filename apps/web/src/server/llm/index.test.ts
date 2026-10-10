import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseServerEnv } from "@/lib/env";

import { getInterpreter, llmStatus } from ".";

describe("llm adapter", () => {
  it("is disabled when no provider is configured", async () => {
    expect(llmStatus(parseServerEnv({}))).toMatchObject({ enabled: false, provider: "none" });
    const result = await getInterpreter().interpret({
      text: "Compare Vintage and Modern",
      context: "",
      schema: z.object({}),
    });
    expect(result).toMatchObject({ ok: false, reason: "disabled" });
  });

  it("stays disabled when a provider is selected without credentials", () => {
    const status = llmStatus(parseServerEnv({ LLM_PROVIDER: "anthropic" }));
    expect(status).toMatchObject({ enabled: false, reason: "ANTHROPIC_API_KEY is not set" });
  });
});
