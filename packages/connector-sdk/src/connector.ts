import type {
  ChangeSet,
  CheckpointManifest,
  ConnectorManifest,
  DocumentInfo,
  Element,
  OperationName,
  ValidationResult,
} from "@sonder/contracts";

/**
 * Opaque handles let each connector use its own storage and document types
 * (UXP file entries, native document ids, project paths) without leaking them
 * into shared code.
 */
export interface AssetRef {
  /** Connector-defined identifier for an open document or project. */
  id: string;
  name: string;
}

export interface CheckpointRef<Location = unknown> {
  manifest: CheckpointManifest;
  location: Location;
}

/**
 * A connector implements whichever operations its application supports and
 * declares them in `manifest().operations`. Callers must check the manifest
 * before invoking an optional operation.
 */
export interface Connector<Location = unknown> {
  manifest(): ConnectorManifest;
  discoverAssets?(): Promise<AssetRef[]>;
  readProperties?(asset: AssetRef): Promise<{ document: DocumentInfo; elements: Element[] }>;
  validateProposal?(asset: AssetRef, changeSet: ChangeSet): Promise<ValidationResult>;
  captureCheckpoint?(asset: AssetRef, destination: Location): Promise<CheckpointRef<Location>>;
  createCandidate?(
    source: CheckpointRef<Location>,
    changeSet: ChangeSet,
    destination: Location,
  ): Promise<CheckpointRef<Location>>;
  generatePreview?(asset: AssetRef, destination: Location): Promise<unknown>;
  openCheckpoint?(
    checkpoint: CheckpointRef<Location>,
    workingLocation: Location,
  ): Promise<AssetRef>;
}

export function supportsOperation(manifest: ConnectorManifest, operation: OperationName): boolean {
  return manifest.operations.includes(operation);
}
