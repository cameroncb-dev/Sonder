import type { ConnectorManifest } from "@sonder/contracts";

export const CONNECTOR_VERSION = "0.2.0";
export const PSD_MEDIA_TYPE = "image/vnd.adobe.photoshop";

export function photoshopManifest(applicationVersion?: string): ConnectorManifest {
  return {
    application: "photoshop",
    connectorVersion: CONNECTOR_VERSION,
    ...(applicationVersion ? { applicationVersion } : {}),
    assetTypes: ["psd"],
    operations: [
      "discoverAssets",
      "readProperties",
      "validateProposal",
      "captureCheckpoint",
      "createCandidate",
      "generatePreview",
      "openCheckpoint",
      "reportStatus",
    ],
    elementKinds: [
      { kind: "text", properties: ["text.content", "text.font", "text.size", "text.color"] },
      { kind: "solid_fill", properties: ["fill.color"] },
    ],
    previewFormats: ["image/png"],
    colorModes: ["RGBColorMode"],
    runtime: { host: "PS>=24.2.0", uxp: "manifest v5" },
    limitations: [
      "Text layers must use one font, size and color throughout (no mixed formatting).",
      "Background colors are supported only on solid-color fill layers.",
      "Color changes require RGB documents.",
      "Deleted and recreated layers are not matched automatically; remap roles instead.",
      "Pixel edits are preserved in snapshots but not merged.",
    ],
  };
}
