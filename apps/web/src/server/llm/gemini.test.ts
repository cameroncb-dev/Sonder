import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parseServerEnv } from "@/lib/env";

import { llmStatus } from ".";
import { geminiInterpreter } from "./gemini";

const reply = (text: string, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { candidates: [{ content: { parts: [{ text }] } }] }
        : { error: { message: text } },
    ),
    { status },
  );
const schema = z.object({ ideas: z.array(z.string()).min(1) });
const request = { text: "Suggest", context: "Context", schema };

describe("gemini adapter", () => {
  it("sends the key in a header, never the URL, and includes images", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"ideas":["Serif"]}'));
    const result = await geminiInterpreter("secret-key", "m-1", fetchMock).interpret({
      ...request,
      images: [{ mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }],
    });
    expect(result).toEqual({ ok: true, value: { ideas: ["Serif"] } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent");
    expect(String(url)).not.toContain("secret-key");
    expect(init.headers["x-goog-api-key"]).toBe("secret-key");
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: "image/png", data: "AQID" });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("retries once when the reply doesn't match the schema", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply('{"ideas":[]}'))
      .mockResolvedValueOnce(reply('{"ideas":["Bold"]}'));
    const result = await geminiInterpreter("k", "m", fetchMock).interpret(request);
    expect(result).toEqual({ ok: true, value: { ideas: ["Bold"] } });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).contents[0].parts[0].text).toContain(
      "previous reply was invalid",
    );
  });

  it("gives up after two invalid replies and reports provider errors", async () => {
    const invalid = vi.fn().mockImplementation(async () => reply("not json"));
    expect(await geminiInterpreter("k", "m", invalid).interpret(request)).toMatchObject({
      ok: false,
      reason: "invalid_output",
    });
    const failing = vi.fn().mockResolvedValue(reply("API key not valid", 400));
    expect(await geminiInterpreter("k", "m", failing).interpret(request)).toEqual({
      ok: false,
      reason: "provider_error",
      message: "API key not valid",
    });
  });

  it("is enabled only with a key", () => {
    expect(llmStatus(parseServerEnv({ LLM_PROVIDER: "gemini" }))).toMatchObject({ enabled: false });
    expect(llmStatus(parseServerEnv({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" }))).toEqual({
      enabled: true,
      provider: "gemini",
      model: "gemini-3.8-flash",
    });
  });
});
