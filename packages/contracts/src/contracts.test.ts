import { describe, expect, it } from "vitest";

import {
  CheckpointManifest,
  ConnectorManifest,
  HexColor,
  PropertyValue,
  propertyValuesEqual,
} from ".";

describe("properties", () => {
  it("normalises hex colors and rejects other formats", () => {
    expect(HexColor.parse("#1e3a5f")).toBe("#1E3A5F");
    expect(HexColor.safeParse("1E3A5F").success).toBe(false);
    expect(HexColor.safeParse("#12345").success).toBe(false);
  });

  it("validates value types per property", () => {
    expect(PropertyValue.safeParse({ type: "text.size", value: 48 }).success).toBe(true);
    expect(PropertyValue.safeParse({ type: "text.size", value: -1 }).success).toBe(false);
    expect(PropertyValue.safeParse({ type: "fill.color", value: "red" }).success).toBe(false);
    expect(PropertyValue.safeParse({ type: "layer.opacity", value: 1 }).success).toBe(false);
  });

  it("compares fonts by PostScript name and sizes with tolerance", () => {
    const a = PropertyValue.parse({
      type: "text.font",
      value: { postScriptName: "ArialMT", family: "Arial" },
    });
    const b = PropertyValue.parse({ type: "text.font", value: { postScriptName: "ArialMT" } });
    expect(propertyValuesEqual(a, b)).toBe(true);
    expect(
      propertyValuesEqual({ type: "text.size", value: 48 }, { type: "text.size", value: 48.001 }),
    ).toBe(true);
  });
});

describe("connector manifest", () => {
  it("accepts a non-layer application", () => {
    const result = ConnectorManifest.safeParse({
      application: "video-editor",
      connectorVersion: "0.1.0",
      assetTypes: ["timeline"],
      operations: ["readProperties"],
      elementKinds: [{ kind: "text", properties: ["text.content"] }],
      previewFormats: ["image/jpeg"],
      runtime: {},
      limitations: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("checkpoint manifest", () => {
  it("requires both native and preview files", () => {
    const base = {
      schemaVersion: 1,
      application: "photoshop",
      applicationVersion: "27.8.0",
      connectorVersion: "0.2.0",
      capturedAt: new Date().toISOString(),
      document: { name: "a.psd", width: 10, height: 10, colorMode: "RGB" },
      elements: [],
    };
    const file = {
      name: "a.psd",
      mediaType: "image/vnd.adobe.photoshop",
      bytes: 10,
      digest: "0123456789abcdef",
    };
    expect(CheckpointManifest.safeParse({ ...base, files: { native: file } }).success).toBe(false);
    expect(
      CheckpointManifest.safeParse({ ...base, files: { native: file, preview: file } }).success,
    ).toBe(true);
  });
});
