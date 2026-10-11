import "server-only";

import { z } from "zod";

import type { InterpretRequest, InterpretResult, LanguageInterpreter } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
/** Used when the chosen model stays overloaded after retries. */
export const FALLBACK_GEMINI_MODEL = "gemini-3.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 60_000;
/** Overloaded or rate-limited: worth waiting and retrying. */
const TRANSIENT = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [1_000, 3_000];

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  error?: { message?: string };
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * Gemini through the REST generateContent API. The model is asked for JSON matching the
 * caller's schema; the reply is validated here and retried once with the validation error.
 * The key travels only in a request header from this server. When the model is overloaded
 * (429/5xx), the call is retried with a short backoff and then once on a fallback model.
 */
export function geminiInterpreter(
  apiKey: string,
  model: string = DEFAULT_GEMINI_MODEL,
  fetchImpl: typeof fetch = fetch,
  retryDelaysMs: number[] = RETRY_DELAYS_MS,
): LanguageInterpreter {
  const models = model === FALLBACK_GEMINI_MODEL ? [model] : [model, FALLBACK_GEMINI_MODEL];

  async function call(prompt: string, images: InterpretRequest<unknown>["images"]) {
    let lastError = "Gemini is unavailable";
    for (const name of models) {
      for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
        const result = await callModel(name, prompt, images);
        if (result.ok) return result.text;
        lastError = result.message;
        if (!result.transient) throw new Error(result.message);
        if (attempt < retryDelaysMs.length)
          await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      }
    }
    throw new Error(lastError);
  }

  async function callModel(
    name: string,
    prompt: string,
    images: InterpretRequest<unknown>["images"],
  ): Promise<{ ok: true; text: string } | { ok: false; transient: boolean; message: string }> {
    const response = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(name)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              ...(images ?? []).map((image) => ({
                inline_data: { mime_type: image.mimeType, data: base64(image.data) },
              })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as GenerateResponse;
    if (!response.ok)
      return {
        ok: false,
        transient: TRANSIENT.has(response.status),
        message: body.error?.message ?? `Gemini returned HTTP ${response.status}`,
      };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text)
      return {
        ok: false,
        transient: false,
        message: `Gemini returned no content (${body.candidates?.[0]?.finishReason ?? "unknown"})`,
      };
    return { ok: true, text };
  }

  return {
    provider: "gemini",
    enabled: true,
    async interpret<T>(request: InterpretRequest<T>): Promise<InterpretResult<T>> {
      const shape = JSON.stringify(z.toJSONSchema(request.schema));
      let prompt =
        `${request.context}\n\nRequest: ${request.text}\n\n` +
        `Reply with JSON only, matching this JSON Schema exactly:\n${shape}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        let raw: string;
        try {
          raw = await call(prompt, request.images);
        } catch (error) {
          return {
            ok: false,
            reason: "provider_error",
            message: error instanceof Error ? error.message : String(error),
          };
        }
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          json = undefined;
        }
        const parsed = request.schema.safeParse(json);
        if (parsed.success) return { ok: true, value: parsed.data };
        const issue = parsed.success ? "" : (parsed.error.issues[0]?.message ?? "invalid JSON");
        prompt += `\n\nYour previous reply was invalid (${issue}). Reply again with valid JSON only.`;
      }
      return {
        ok: false,
        reason: "invalid_output",
        message: "Gemini's reply didn't match the expected format twice; try again",
      };
    },
  };
}
