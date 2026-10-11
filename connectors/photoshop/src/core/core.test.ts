import { ConnectorManifest, ElementId } from "@sonder/contracts";
import { describe, expect, it } from "vitest";

import { hexToRgbDescriptor, normalizeHex, rgbDescriptorToHex } from "./colors";
import { layerIdOf, layerRef, randomUuid } from "./identity";
import { photoshopManifest } from "./manifest";
import { hasMixedFormatting } from "./textStyles";

describe("colors", () => {
  it("round-trips hex through Photoshop RGB descriptors", () => {
    expect(hexToRgbDescriptor("#1E3A5F")).toEqual({
      _obj: "RGBColor",
      red: 30,
      grain: 58,
      blue: 95,
    });
    expect(rgbDescriptorToHex({ red: 30, grain: 58, blue: 95 })).toBe("#1E3A5F");
    expect(rgbDescriptorToHex({ red: 29.6, grain: 58.2, blue: 300 })).toBe("#1E3AFF");
    expect(normalizeHex("ff00aa")).toBe("#FF00AA");
  });
});

describe("text styles", () => {
  const range = (from: number, to: number, font: string, size = 12) => ({
    from,
    to,
    textStyle: {
      fontPostScriptName: font,
      size: { _unit: "pointsUnit", _value: size },
      color: { red: 0, grain: 0, blue: 0 },
    },
  });

  it("treats identical ranges as uniform", () => {
    expect(hasMixedFormatting([range(0, 3, "ArialMT"), range(3, 6, "ArialMT")])).toBe(false);
    expect(hasMixedFormatting(undefined)).toBe(false);
  });

  it("detects mixed fonts or sizes, ignoring empty ranges", () => {
    expect(hasMixedFormatting([range(0, 3, "ArialMT"), range(3, 6, "Georgia")])).toBe(true);
    expect(hasMixedFormatting([range(0, 3, "ArialMT"), range(3, 6, "ArialMT", 14)])).toBe(true);
    expect(hasMixedFormatting([range(0, 3, "ArialMT"), range(3, 3, "Georgia")])).toBe(false);
  });
});

describe("identity", () => {
  it("only accepts Photoshop refs with integer layer ids", () => {
    expect(layerIdOf(layerRef(7, "Headline"))).toBe(7);
    expect(layerIdOf({ connector: "illustrator", data: { layerId: 7 } })).toBeUndefined();
    expect(layerIdOf({ connector: "photoshop", data: { layerId: "7" } })).toBeUndefined();
  });

  it("generates valid v4 uuids", () => {
    for (let i = 0; i < 50; i++) expect(ElementId.safeParse(randomUuid()).success).toBe(true);
  });
});

describe("manifest", () => {
  it("is a valid connector manifest", () => {
    expect(ConnectorManifest.safeParse(photoshopManifest("27.8.0")).success).toBe(true);
  });
});
