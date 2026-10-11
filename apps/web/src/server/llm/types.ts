import type { z } from "zod";

/**
 * Provider-independent language interpretation interface.
 *
 * Adapters only turn text into data that must validate against a caller-supplied
 * schema. They never execute code or application commands; the result is a
 * proposal that goes through normal validation, permissions and approval.
 */
export interface InterpretRequest<T> {
  /** User's natural-language request. */
  text: string;
  /** Instructions and context (asset names, checkpoints, capabilities). */
  context: string;
  /** Output must parse against this schema or the call fails. */
  schema: z.ZodType<T>;
  /** Images the model may look at (e.g. document previews), as raw bytes. */
  images?: Array<{ mimeType: string; data: Uint8Array }>;
}

export type InterpretResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "disabled" | "invalid_output" | "provider_error"; message: string };

export interface LanguageInterpreter {
  readonly provider: string;
  readonly enabled: boolean;
  interpret<T>(request: InterpretRequest<T>): Promise<InterpretResult<T>>;
}
