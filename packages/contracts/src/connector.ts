import { z } from "zod";

import { ElementKindCapability } from "./elements";

export const OperationName = z.enum([
  "discoverAssets",
  "captureCheckpoint",
  "readProperties",
  "validateProposal",
  "createCandidate",
  "generatePreview",
  "openCheckpoint",
  "reportStatus",
]);
export type OperationName = z.infer<typeof OperationName>;

/** Capability declaration. The UI enables actions from this, never from the application name. */
export const ConnectorManifest = z.object({
  application: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  connectorVersion: z.string().regex(/^\d+\.\d+\.\d+/),
  applicationVersion: z.string().optional(),
  assetTypes: z.array(z.string().min(1)).min(1),
  operations: z.array(OperationName).min(1),
  elementKinds: z.array(ElementKindCapability),
  previewFormats: z.array(z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/)),
  colorModes: z.array(z.string()).optional(),
  runtime: z.record(z.string(), z.string()),
  limitations: z.array(z.string()),
});
export type ConnectorManifest = z.infer<typeof ConnectorManifest>;
