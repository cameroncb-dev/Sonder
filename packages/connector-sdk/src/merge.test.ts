import type { Element, PropertyValue } from "@sonder/contracts";
import { describe, expect, it } from "vitest";

import { mergeBases, mergeElements, nativeIdentity, planCombination, rowId } from ".";

const kinds = [
  {
    kind: "text" as const,
    properties: ["text.content", "text.font", "text.size", "text.color"] as const,
  },
  { kind: "solid_fill" as const, properties: ["fill.color"] as const },
].map((k) => ({ kind: k.kind, properties: [...k.properties] }));
const options = { identityFields: ["layerId"], elementKinds: kinds };

const font = (postScriptName: string) =>
  ({ type: "text.font", value: { postScriptName } }) as const;
const text = (layerId: number, name: string, props: PropertyValue[], editable = true): Element => ({
  native: { connector: "photoshop", data: { layerId, layerName: name } },
  kind: "text",
  name,
  properties: props,
  editable,
});
const fill = (layerId: number, color: string): Element => ({
  native: { connector: "photoshop", data: { layerId, layerName: "Background" } },
  kind: "solid_fill",
  name: "Background",
  properties: [{ type: "fill.color", value: color }],
  editable: true,
});
const headline = (f: string, color = "#000000", name = "Headline") =>
  text(2, name, [
    { type: "text.content", value: "Hello" },
    font(f),
    { type: "text.size", value: 48 },
    { type: "text.color", value: color },
  ]);

const base = [fill(1, "#FFFFFF"), headline("ArialMT")];
const row = (rows: ReturnType<typeof mergeElements>["rows"], property: string) =>
  rows.find((r) => r.property === property)!;

describe("mergeElements", () => {
  it("combines one branch's font with another's background", () => {
    const fontBranch = [fill(1, "#FFFFFF"), headline("Georgia")];
    const bgBranch = [fill(1, "#112233"), headline("ArialMT")];
    const merge = mergeElements(base, fontBranch, bgBranch, options);
    expect(row(merge.rows, "text.font").status).toBe("target");
    expect(row(merge.rows, "fill.color").status).toBe("source");
    expect(row(merge.rows, "text.content").status).toBe("unchanged");

    const plan = planCombination(merge, {});
    expect(plan.issues).toEqual([]);
    // Only the background changes relative to the font branch; everything else is preserved.
    expect(plan.changes).toEqual([
      {
        key: nativeIdentity(fill(1, "").native, ["layerId"]),
        property: { type: "fill.color", value: "#112233" },
      },
    ]);
  });

  it("treats identical changes on both sides as compatible", () => {
    const a = [fill(1, "#FFFFFF"), headline("Georgia")];
    const merge = mergeElements(base, a, a, options);
    expect(row(merge.rows, "text.font").status).toBe("both_same");
    expect(planCombination(merge, {}).changes).toEqual([]);
  });

  it("requires a choice when both sides changed a property differently", () => {
    const merge = mergeElements(base, [headline("Georgia")], [headline("Futura")], options);
    const conflict = row(merge.rows, "text.font");
    expect(conflict.status).toBe("conflict");
    const unresolved = planCombination(merge, {});
    expect(unresolved.issues.map((i) => i.code)).toEqual(["CONFLICT_UNRESOLVED"]);

    const takeSource = planCombination(merge, { [rowId(conflict)]: "source" });
    expect(takeSource.issues).toEqual([]);
    expect(takeSource.changes.map((c) => c.property)).toEqual([font("Futura")]);
    expect(planCombination(merge, { [rowId(conflict)]: "target" }).changes).toEqual([]);
  });

  it("respects exclusions of source changes", () => {
    const merge = mergeElements(base, base, [fill(1, "#112233"), headline("Futura")], options);
    const plan = planCombination(merge, { [rowId(row(merge.rows, "fill.color"))]: "target" });
    expect(plan.changes.map((c) => c.property.type)).toEqual(["text.font"]);
    expect(plan.choices[rowId(row(merge.rows, "fill.color"))]).toBe("target");
  });

  it("matches renamed elements by identity and compares fonts by PostScript name", () => {
    const renamed = [fill(1, "#FFFFFF"), headline("ArialMT", "#000000", "Title")];
    const merge = mergeElements(base, base, renamed, options);
    expect(merge.structural).toEqual([]);
    expect(merge.rows.every((r) => r.status === "unchanged")).toBe(true);
  });

  it("reports added and removed elements without combining them", () => {
    const extra = text(9, "Caption", [{ type: "text.content", value: "New" }]);
    const merge = mergeElements(base, [headline("ArialMT")], [...base, extra], options);
    expect(merge.structural.map((s) => s.change).sort()).toEqual([
      "added_in_source",
      "removed_in_target",
    ]);
    expect(merge.rows.some((r) => r.name === "Caption" || r.kind === "solid_fill")).toBe(false);
  });

  it("treats elements added on both sides as independent, never as a conflict", () => {
    // Both branches added a fill and Photoshop gave each the same next layer id.
    const target = [...base, fill(5, "#000000")];
    const source = [...base, fill(5, "#F41032")];
    const merge = mergeElements(base, target, source, options);
    expect(merge.structural).toEqual([expect.objectContaining({ change: "added_in_both" })]);
    expect(merge.rows.some((r) => r.status === "conflict")).toBe(false);
    expect(planCombination(merge, {}).changes).toEqual([]);
  });

  it("refuses to take source values the connector cannot edit", () => {
    const locked = [fill(1, "#FFFFFF"), { ...headline("ArialMT"), editable: false }];
    const merge = mergeElements(base, locked, [fill(1, "#FFFFFF"), headline("Futura")], options);
    const r = row(merge.rows, "text.font");
    expect(r.supported).toBe(false);
    expect(planCombination(merge, {}).changes).toEqual([]);
    expect(planCombination(merge, { [rowId(r)]: "source" }).issues[0]?.code).toBe(
      "UNSUPPORTED_PROPERTY",
    );
  });

  it("rejects choices for rows that do not exist", () => {
    const merge = mergeElements(base, base, base, options);
    expect(planCombination(merge, { "nope|text.font": "source" }).issues[0]?.code).toBe(
      "UNKNOWN_ROW",
    );
  });
});

describe("mergeBases", () => {
  // a ← b ← c (main);  a ← d (alt);  e merges c and d
  const parents = new Map([
    ["b", ["a"]],
    ["c", ["b"]],
    ["d", ["a"]],
    ["e", ["c", "d"]],
  ]);

  it("finds the branch point", () => expect(mergeBases(parents, "c", "d")).toEqual(["a"]));
  it("treats an ancestor as the base (fast-forward)", () =>
    expect(mergeBases(parents, "b", "c")).toEqual(["b"]));
  it("uses the latest common ancestor after a merge", () =>
    expect(mergeBases(parents, "e", "d")).toEqual(["d"]));
  it("reports no base for unrelated histories", () =>
    expect(mergeBases(new Map(), "x", "y")).toEqual([]));
  it("reports several bases for criss-cross histories", () => {
    const criss = new Map([
      ["x", ["a", "b"]],
      ["y", ["a", "b"]],
    ]);
    expect(mergeBases(criss, "x", "y").sort()).toEqual(["a", "b"]);
  });
});
