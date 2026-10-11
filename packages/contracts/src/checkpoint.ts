import { z } from "zod";

import { Element, ElementMapping } from "./elements";
import { PropertyValue } from "./properties";

export const DocumentInfo = z.object({
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  resolution: z.number().positive().optional(),
  colorMode: z.string(),
});
export type DocumentInfo = z.infer<typeof DocumentInfo>;

export const ArtifactFile = z.object({
  name: z.string().min(1),
  mediaType: z.string().min(1),
  bytes: z.number().int().positive(),
  /** FNV-1a 64-bit hex digest of the file bytes, for integrity checks. */
  digest: z.string().regex(/^[0-9a-f]{16}$/),
});
export type ArtifactFile = z.infer<typeof ArtifactFile>;

/** Native snapshot, preview and element manifest captured from one document state. */
export const CheckpointManifest = z.object({
  schemaVersion: z.literal(1),
  application: z.string(),
  applicationVersion: z.string(),
  connectorVersion: z.string(),
  capturedAt: z.iso.datetime(),
  document: DocumentInfo,
  elements: z.array(Element),
  files: z.object({ native: ArtifactFile, preview: ArtifactFile }),
});
export type CheckpointManifest = z.infer<typeof CheckpointManifest>;

/** One requested property change on a mapped element. */
export const Change = z.object({
  elementId: z.uuid(),
  property: PropertyValue,
});
export type Change = z.infer<typeof Change>;

export const ChangeSet = z.object({
  mappings: z.array(ElementMapping),
  changes: z.array(Change).min(1),
});
export type ChangeSet = z.infer<typeof ChangeSet>;
