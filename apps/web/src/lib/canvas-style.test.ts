import { describe, expect, it } from "vitest";

import { FONTS, fontFamily, NoteContent, SectionContent, TextContent } from "./canvas-style";

describe("canvas card content", () => {
  it("gives notes saved before styles existed the default style", () => {
    expect(NoteContent.parse({ text: "Old note" })).toEqual({
      text: "Old note",
      shape: "square",
      color: "yellow",
      font: "System UI",
    });
  });

  it("accepts every listed font and rejects unknown ones", () => {
    for (const font of FONTS) expect(TextContent.safeParse({ text: "", font }).success).toBe(true);
    expect(TextContent.safeParse({ text: "", font: "Not A Font" }).success).toBe(false);
    expect(NoteContent.safeParse({ text: "", shape: "hexagon" }).success).toBe(false);
  });

  it("offers dozens of fonts, each with a fallback", () => {
    expect(FONTS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(FONTS).size).toBe(FONTS.length);
    expect(fontFamily("Playfair Display")).toBe(
      "'Playfair Display', system-ui, -apple-system, 'Segoe UI', sans-serif",
    );
    expect(fontFamily("Georgia")).toBe("Georgia, serif");
  });

  it("limits section titles", () => {
    expect(SectionContent.safeParse({ title: "x".repeat(201) }).success).toBe(false);
    expect(SectionContent.parse({ title: "Moodboard" }).color).toBe("grey");
  });
});
