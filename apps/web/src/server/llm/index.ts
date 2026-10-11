import "server-only";

import { serverEnv, type ServerEnv } from "@/lib/env";

import { DEFAULT_GEMINI_MODEL, geminiInterpreter } from "./gemini";
import type { InterpretResult, LanguageInterpreter } from "./types";

export type { InterpretRequest, InterpretResult, LanguageInterpreter } from "./types";

/** Used whenever no provider is configured. Core workflows never depend on an LLM. */
export const disabledInterpreter: LanguageInterpreter = {
  provider: "none",
  enabled: false,
  async interpret<T>(): Promise<InterpretResult<T>> {
    return {
      ok: false,
      reason: "disabled",
      message: "Language interpretation is not configured. Use the manual controls.",
    };
  },
};

export type LlmStatus =
  | { enabled: false; provider: "none"; reason: string }
  | { enabled: false; provider: string; reason: string }
  | { enabled: true; provider: string; model: string };

/** Reports whether a provider is selected and has the credentials it needs. */
export function llmStatus(env: ServerEnv = serverEnv()): LlmStatus {
  if (env.LLM_PROVIDER === "none") {
    return { enabled: false, provider: "none", reason: "LLM_PROVIDER is not set" };
  }
  if (env.LLM_PROVIDER === "gemini") {
    return env.GEMINI_API_KEY
      ? { enabled: true, provider: "gemini", model: env.LLM_MODEL ?? DEFAULT_GEMINI_MODEL }
      : { enabled: false, provider: "gemini", reason: "GEMINI_API_KEY is not set" };
  }
  if (!env.ANTHROPIC_API_KEY) {
    return { enabled: false, provider: "anthropic", reason: "ANTHROPIC_API_KEY is not set" };
  }
  return { enabled: false, provider: "anthropic", reason: "The Anthropic adapter isn't built yet" };
}

export function getInterpreter(env: ServerEnv = serverEnv()): LanguageInterpreter {
  const status = llmStatus(env);
  if (status.enabled && status.provider === "gemini")
    return geminiInterpreter(env.GEMINI_API_KEY!, status.model);
  return disabledInterpreter;
}
