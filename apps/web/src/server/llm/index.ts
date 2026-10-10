import "server-only";

import { serverEnv, type ServerEnv } from "@/lib/env";

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

/**
 * Reports whether a provider is selected and has credentials. No concrete
 * provider is wired up in Phase 1; a configured provider reports "pending".
 */
export function llmStatus(env: ServerEnv = serverEnv()): LlmStatus {
  if (env.LLM_PROVIDER === "none") {
    return { enabled: false, provider: "none", reason: "LLM_PROVIDER is not set" };
  }
  if (env.LLM_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    return { enabled: false, provider: "anthropic", reason: "ANTHROPIC_API_KEY is not set" };
  }
  return {
    enabled: false,
    provider: env.LLM_PROVIDER,
    reason: "Credentials present; provider implementation is scheduled for Phase 8",
  };
}

export function getInterpreter(): LanguageInterpreter {
  return disabledInterpreter;
}
