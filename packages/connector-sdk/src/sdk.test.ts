import type { ConnectorManifest, Element } from "@sonder/contracts";
import { describe, expect, it } from "vitest";

import { diffElements, fnv1a64, supportsOperation, validateChangeSetShape } from ".";

const manifest: ConnectorManifest = {
  application: "photoshop",
  connectorVersion: "0.2.0",
  assetTypes: ["psd"],
  operations: ["readProperties", "validateProposal"],
  elementKinds: [
    { kind: "text", properties: ["text.content", "text.font", "text.size", "text.color"] },
    { kind: "solid_fill", properties: ["fill.color"] },
  ],
  previewFormats: ["image/png"],
  runtime: {},
  limitations: [],
};

const headline = "11111111-1111-4111-8111-111111111111";
const background = "22222222-2222-4222-8222-222222222222";
const native = (layerId: number) => ({ connector: "photoshop", data: { layerId } });

describe("validateChangeSetShape", () => {
  const mappings = [
    { elementId: headline, role: "headline", kind: "text" as const, native: native(2) },
    { elementId: background, role: "background", kind: "solid_fill" as const, native: native(1) },
  ];

  it("accepts supported changes on mapped elements", () => {
    const { result } = validateChangeSetShape(manifest, {
      mappings,
      changes: [
        {
          elementId: headline,
          property: { type: "text.font", value: { postScriptName: "Georgia" } },
        },
        { elementId: background, property: { type: "fill.color", value: "#8b1e3f" } },
      ],
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects unsupported properties for an element kind", () => {
    const { result } = validateChangeSetShape(manifest, {
      mappings,
      changes: [{ elementId: background, property: { type: "text.size", value: 12 } }],
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]?.code).toBe("UNSUPPORTED_PROPERTY");
  });

  it("rejects unmapped elements and duplicate roles", () => {
    const { result } = validateChangeSetShape(manifest, {
      mappings: [
        ...mappings,
        { ...mappings[0]!, elementId: "33333333-3333-4333-8333-333333333333" },
      ],
      changes: [
        {
          elementId: "44444444-4444-4444-8444-444444444444",
          property: { type: "fill.color", value: "#000000" },
        },
      ],
    });
    const codes = !result.ok ? result.issues.map((i) => i.code) : [];
    expect(codes).toEqual(["DUPLICATE_ROLE", "ROLE_UNMAPPED"]);
  });

  it("reports schema errors as INVALID_VALUE", () => {
    const { result } = validateChangeSetShape(manifest, { mappings, changes: [] });
    expect(!result.ok && result.issues[0]?.code).toBe("INVALID_VALUE");
  });
});

describe("helpers", () => {
  it("checks operations from the manifest", () => {
    expect(supportsOperation(manifest, "readProperties")).toBe(true);
    expect(supportsOperation(manifest, "createCandidate")).toBe(false);
  });

  it("computes FNV-1a 64 digests", () => {
    expect(fnv1a64(new Uint8Array())).toBe("cbf29ce484222325");
    expect(fnv1a64(Uint8Array.of(0x61))).toBe("af63dc4c8601ec8c"); // "a"
  });

  it("diffs elements by identity", () => {
    const el = (id: number, color: string): Element => ({
      native: native(id),
      kind: "solid_fill",
      name: "bg",
      properties: [{ type: "fill.color", value: color }],
      editable: true,
    });
    const key = (e: Element) => String(e.native.data.layerId);
    expect(diffElements([el(1, "#000000")], [el(1, "#000000")], key)).toEqual([]);
    expect(diffElements([el(1, "#000000")], [el(1, "#FFFFFF")], key)[0]?.reason).toBe("changed");
    expect(diffElements([el(1, "#000000")], [], key)[0]?.reason).toBe("missing");
  });
});
