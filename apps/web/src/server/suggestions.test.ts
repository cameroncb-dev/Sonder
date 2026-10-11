import type { Element } from "@sonder/contracts";
import { describe, expect, it } from "vitest";

import { describeLayers, suggestionChangeSet, validateSuggestions } from "./suggestions";

const native = (layerId: number) => ({ connector: "photoshop", data: { layerId } });
const elements: Element[] = [
  {
    native: native(1),
    kind: "solid_fill",
    name: "Background",
    properties: [{ type: "fill.color", value: "#1E3A5F" }],
    editable: true,
  },
  {
    native: native(2),
    kind: "text",
    name: "Headline",
    properties: [
      { type: "text.content", value: "Sonder Poster" },
      { type: "text.font", value: { postScriptName: "ArialMT" } },
      { type: "text.size", value: 64 },
      { type: "text.color", value: "#FFFFFF" },
    ],
    editable: true,
  },
  {
    native: native(3),
    kind: "text",
    name: "Mixed",
    properties: [{ type: "text.content", value: "x" }],
    editable: false,
  },
];
const context = {
  elements,
  elementKinds: [
    {
      kind: "text" as const,
      properties: ["text.content", "text.font", "text.size", "text.color"] as Array<
        "text.content" | "text.font" | "text.size" | "text.color"
      >,
    },
    { kind: "solid_fill" as const, properties: ["fill.color" as const] },
  ],
  identityFields: ["layerId"],
  fonts: ["ArialMT", "Georgia"],
};
const suggestion = (
  changes: Array<{ layer: string; property: never; value: string | number }>,
) => ({
  suggestions: [{ title: "Editorial", rationale: "Serif and warm", changes }],
});
type C = Parameters<typeof suggestion>[0][number];
const change = (layer: string, property: string, value: string | number) =>
  ({ layer, property, value }) as unknown as C;

describe("validateSuggestions", () => {
  it("keeps well-formed changes to editable layers and normalises values", () => {
    const [s] = validateSuggestions(
      suggestion([
        change("L1", "fill.color", "#f5f1e8"),
        change("L2", "text.font", "Georgia"),
        change("L2", "text.size", "72"),
      ]),
      context,
    );
    expect(s!.changes).toEqual([
      expect.objectContaining({
        element: "Background",
        property: "fill.color",
        from: "#1E3A5F",
        to: "#F5F1E8",
      }),
      expect.objectContaining({
        element: "Headline",
        property: "text.font",
        to: { postScriptName: "Georgia" },
      }),
      expect.objectContaining({ element: "Headline", property: "text.size", to: 72 }),
    ]);
    expect(s!.skipped).toEqual([]);
  });

  it("drops anything that doesn't fit the document, with reasons", () => {
    const [s] = validateSuggestions(
      suggestion([
        change("L9", "fill.color", "#000000"),
        change("L1", "text.color", "#000000"),
        change("L3", "text.content", "y"),
        change("L2", "text.color", "red"),
        change("L2", "text.font", "Comic Neue"),
        change("L2", "text.size", 9999),
        change("L2", "text.content", "New headline"),
      ]),
      context,
    );
    expect(s!.changes.map((c) => c.property)).toEqual(["text.content"]);
    expect(s!.skipped).toHaveLength(6);
  });

  it("drops suggestions that would change nothing", () => {
    expect(
      validateSuggestions(suggestion([change("L2", "text.color", "#ffffff")]), context),
    ).toEqual([]);
  });
});

describe("suggestionChangeSet", () => {
  it("rebuilds a change set from the document's current layers", () => {
    const [s] = validateSuggestions(
      suggestion([change("L1", "fill.color", "#F5F1E8"), change("L2", "text.font", "Georgia")]),
      context,
    );
    const set = suggestionChangeSet(s!.changes, context);
    expect(set.mappings.map((m) => m.native)).toEqual([native(1), native(2)]);
    expect(set.changes.map((c) => c.property)).toEqual([
      { type: "fill.color", value: "#F5F1E8" },
      { type: "text.font", value: { postScriptName: "Georgia" } },
    ]);
  });

  it("refuses when the document no longer has the layer", () => {
    const [s] = validateSuggestions(suggestion([change("L1", "fill.color", "#F5F1E8")]), context);
    expect(() =>
      suggestionChangeSet(s!.changes, { ...context, elements: elements.slice(1) }),
    ).toThrow("document changed");
  });
});

it("describes layers by short id", () => {
  expect(describeLayers(elements)).toContain(
    'L2: text layer "Headline": text.content="Sonder Poster"',
  );
  expect(describeLayers(elements)).toContain("(not editable)");
});
