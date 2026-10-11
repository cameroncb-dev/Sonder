import {
  type AssetRef,
  type CheckpointRef,
  type Connector,
  ConnectorError,
  fnv1a64,
  validateChangeSetShape,
} from "@sonder/connector-sdk";
import {
  type ChangeSet,
  CheckpointManifest,
  type ElementMapping,
  type Issue,
  propertyValuesEqual,
  type ValidationResult,
} from "@sonder/contracts";
import { app, constants, core } from "photoshop";
import type { Document } from "photoshop/dom/Document";
import { host } from "uxp";

import { layerIdOf } from "./core/identity";
import { CONNECTOR_VERSION, photoshopManifest, PSD_MEDIA_TYPE } from "./core/manifest";
import { applyProperty } from "./ps/apply";
import { documentInfo, findDocument, findLayer, readElements } from "./ps/elements";
import {
  asPsEntry,
  describeFile,
  type FileEntry,
  type Folder,
  getFile,
  readBytes,
  readJson,
  writeBytes,
  writeJson,
} from "./ps/files";
import { installedFonts } from "./ps/fonts";

export type PhotoshopCheckpoint = CheckpointRef<Folder>;

const MANIFEST_SUFFIX = ".manifest.json";
const RGB_MODE = "RGBColorMode";

const kindOfLayer = (kind: string) =>
  kind === constants.LayerKind.TEXT
    ? "text"
    : kind === constants.LayerKind.SOLIDFILL
      ? "solid_fill"
      : undefined;

function docRef(doc: Document): AssetRef {
  return { id: String(doc.id), name: doc.name };
}

function requireDocument(asset: AssetRef): Document {
  const doc = findDocument(Number(asset.id));
  if (!doc) {
    throw new ConnectorError({
      code: "NO_DOCUMENT",
      message: `Document "${asset.name}" (${asset.id}) is not open`,
    });
  }
  return doc;
}

/** Runs Photoshop-modifying work in one modal scope so no user edit can interleave. */
function modal<T>(commandName: string, fn: () => Promise<T>): Promise<T> {
  return core.executeAsModal(async () => fn(), { commandName });
}

/**
 * Native checks for role mappings: the layer exists, is the declared kind, and
 * can be edited safely. Deleted-and-recreated layers are not matched by name.
 */
export async function validateMappings(
  doc: Document,
  mappings: ElementMapping[],
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const elements = await readElements(doc);
  for (const mapping of mappings) {
    const layerId = layerIdOf(mapping.native);
    const layer = layerId === undefined ? undefined : findLayer(doc, layerId);
    const base = { elementId: mapping.elementId, role: mapping.role };
    if (!layer) {
      issues.push({
        ...base,
        code: "ELEMENT_NOT_FOUND",
        message: `Role "${mapping.role}" points to layer ${String(mapping.native.data.layerName ?? layerId)} (id ${layerId}), which no longer exists in "${doc.name}"`,
        details: { layerId, layerName: mapping.native.data.layerName },
      });
      continue;
    }
    const actualKind = kindOfLayer(layer.kind);
    if (actualKind !== mapping.kind) {
      issues.push({
        ...base,
        code: "ELEMENT_KIND_MISMATCH",
        message: `Role "${mapping.role}" expects a ${mapping.kind} element but layer "${layer.name}" is ${String(layer.kind)}`,
      });
      continue;
    }
    const element = elements.find((e) => layerIdOf(e.native) === layerId);
    if (element && !element.editable) {
      issues.push({
        ...base,
        code: "ELEMENT_NOT_EDITABLE",
        message: `Layer "${layer.name}" cannot be edited: ${element.notEditableReason ?? "unsupported content"}`,
      });
    }
  }
  return issues;
}

async function validateAgainstDocument(doc: Document, changeSet: ChangeSet): Promise<Issue[]> {
  const issues = await validateMappings(doc, changeSet.mappings);
  const fonts = installedFonts();
  const mappingById = new Map(changeSet.mappings.map((m) => [m.elementId, m]));
  for (const change of changeSet.changes) {
    const mapping = mappingById.get(change.elementId);
    const base = {
      elementId: change.elementId,
      role: mapping?.role,
      property: change.property.type,
    };
    if (change.property.type === "text.font" && !fonts.has(change.property.value.postScriptName)) {
      issues.push({
        ...base,
        code: "MISSING_FONT",
        message: `Font "${change.property.value.postScriptName}" is not installed`,
        details: { postScriptName: change.property.value.postScriptName },
      });
    }
    const isColor = change.property.type === "text.color" || change.property.type === "fill.color";
    if (isColor && String(doc.mode) !== RGB_MODE) {
      issues.push({
        ...base,
        code: "UNSUPPORTED_COLOR_MODE",
        message: `Color changes require an RGB document; "${doc.name}" is ${String(doc.mode)}`,
      });
    }
  }
  return issues;
}

async function verifyCheckpointFile(checkpoint: PhotoshopCheckpoint): Promise<FileEntry> {
  const expected = checkpoint.manifest.files.native;
  let file: FileEntry;
  try {
    file = await getFile(checkpoint.location, expected.name);
  } catch {
    throw new ConnectorError({
      code: "CHECKPOINT_INCOMPLETE",
      message: `Snapshot file ${expected.name} is missing`,
    });
  }
  const bytes = await readBytes(file);
  if (bytes.length !== expected.bytes || fnv1a64(bytes) !== expected.digest) {
    throw new ConnectorError({
      code: "CHECKPOINT_INCOMPLETE",
      message: `Snapshot file ${expected.name} does not match its manifest`,
    });
  }
  return file;
}

async function copyToWorkingFile(
  source: FileEntry,
  folder: Folder,
  name: string,
): Promise<FileEntry> {
  return writeBytes(folder, name, await readBytes(source));
}

export class PhotoshopConnector implements Connector<Folder> {
  manifest() {
    return photoshopManifest(host.version);
  }

  async discoverAssets(): Promise<AssetRef[]> {
    const assets: AssetRef[] = [];
    for (let i = 0; i < app.documents.length; i++) {
      const doc = app.documents[i];
      if (doc) assets.push(docRef(doc));
    }
    return assets;
  }

  activeAsset(): AssetRef | undefined {
    return app.activeDocument ? docRef(app.activeDocument) : undefined;
  }

  async readProperties(asset: AssetRef) {
    const doc = requireDocument(asset);
    return { document: documentInfo(doc), elements: await readElements(doc) };
  }

  async validateMappings(asset: AssetRef, mappings: ElementMapping[]): Promise<ValidationResult> {
    const issues = await validateMappings(requireDocument(asset), mappings);
    return issues.length ? { ok: false, issues } : { ok: true };
  }

  async validateProposal(asset: AssetRef, input: ChangeSet): Promise<ValidationResult> {
    const { result, changeSet } = validateChangeSetShape(this.manifest(), input);
    if (!changeSet) return result;
    const issues = await validateAgainstDocument(requireDocument(asset), changeSet);
    return issues.length ? { ok: false, issues } : { ok: true };
  }

  /**
   * Captures snapshot, preview and manifest from one document state inside a
   * single modal scope. The manifest is written last, so a checkpoint without
   * a manifest is incomplete and must not be treated as recoverable.
   */
  async captureCheckpoint(
    asset: AssetRef,
    destination: Folder,
    baseName = "checkpoint",
  ): Promise<PhotoshopCheckpoint> {
    const doc = requireDocument(asset);
    return modal(`Sonder: capture ${baseName}`, async () => {
      const document = documentInfo(doc);
      const elements = await readElements(doc);
      const nativeFile = await destination.createFile(`${baseName}.psd`, { overwrite: true });
      await doc.saveAs.psd(asPsEntry(nativeFile), undefined, true);
      const previewFile = await destination.createFile(`${baseName}.png`, { overwrite: true });
      await doc.saveAs.png(asPsEntry(previewFile), undefined, true);

      const manifest = CheckpointManifest.parse({
        schemaVersion: 1,
        application: "photoshop",
        applicationVersion: host.version,
        connectorVersion: CONNECTOR_VERSION,
        capturedAt: new Date().toISOString(),
        document,
        elements,
        files: {
          native: await describeFile(nativeFile, PSD_MEDIA_TYPE),
          preview: await describeFile(previewFile, "image/png"),
        },
      });
      await writeJson(destination, `${baseName}${MANIFEST_SUFFIX}`, manifest);
      return { manifest, location: destination };
    });
  }

  /** Loads a checkpoint from a folder. Fails if the manifest is missing or invalid. */
  async loadCheckpoint(folder: Folder, baseName: string): Promise<PhotoshopCheckpoint> {
    let raw: unknown;
    try {
      raw = await readJson(folder, `${baseName}${MANIFEST_SUFFIX}`);
    } catch {
      throw new ConnectorError({
        code: "CHECKPOINT_INCOMPLETE",
        message: `Checkpoint "${baseName}" has no manifest`,
      });
    }
    const parsed = CheckpointManifest.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError({
        code: "CHECKPOINT_INCOMPLETE",
        message: `Checkpoint "${baseName}" has an invalid manifest`,
      });
    }
    return { manifest: parsed.data, location: folder };
  }

  async generatePreview(asset: AssetRef, destination: Folder, name = "preview.png") {
    const doc = requireDocument(asset);
    return modal("Sonder: export preview", async () => {
      const file = await destination.createFile(name, { overwrite: true });
      await doc.saveAs.png(asPsEntry(file), undefined, true);
      return describeFile(file, "image/png");
    });
  }

  /**
   * Opens a copy of the checkpoint's snapshot. The snapshot file itself is
   * never opened, so saving in Photoshop cannot overwrite it.
   */
  async openCheckpoint(
    checkpoint: PhotoshopCheckpoint,
    workingFolder: Folder,
    workingName?: string,
  ): Promise<AssetRef> {
    const source = await verifyCheckpointFile(checkpoint);
    const name =
      workingName ??
      `${checkpoint.manifest.files.native.name.replace(/\.psd$/i, "")}-working-${Date.now()}.psd`;
    const working = await copyToWorkingFile(source, workingFolder, name);
    const doc = await modal("Sonder: open checkpoint", () => app.open(asPsEntry(working)));
    return docRef(doc);
  }

  /**
   * Applies a change set to a separate editable copy of `source` and captures
   * it as a new checkpoint. The source snapshot is only read, never written.
   */
  async createCandidate(
    source: PhotoshopCheckpoint,
    input: ChangeSet,
    destination: Folder,
    baseName = "candidate",
  ): Promise<PhotoshopCheckpoint> {
    const { result, changeSet } = validateChangeSetShape(this.manifest(), input);
    if (!changeSet) throw new ConnectorError(result.ok ? [] : result.issues);

    const asset = await this.openCheckpoint(source, destination, `${baseName}-working.psd`);
    const doc = requireDocument(asset);
    try {
      const issues = await validateAgainstDocument(doc, changeSet);
      if (issues.length) throw new ConnectorError(issues);

      await modal(`Sonder: apply ${baseName}`, async () => {
        app.activeDocument = doc;
        const mappingById = new Map(changeSet.mappings.map((m) => [m.elementId, m]));
        for (const change of changeSet.changes) {
          const layer = findLayer(doc, layerIdOf(mappingById.get(change.elementId)!.native)!)!;
          await applyProperty(doc, layer, change.property);
        }
      });

      await this.assertApplied(doc, changeSet);
      return await this.captureCheckpoint(asset, destination, baseName);
    } finally {
      await modal("Sonder: close working copy", () =>
        doc.close(constants.SaveOptions.DONOTSAVECHANGES),
      );
      try {
        await (await getFile(destination, `${baseName}-working.psd`)).delete();
      } catch {
        // Best effort: the working copy is disposable.
      }
    }
  }

  /** Re-reads changed properties so silent substitutions (e.g. fonts) surface as errors. */
  private async assertApplied(doc: Document, changeSet: ChangeSet): Promise<void> {
    const elements = await readElements(doc);
    const issues: Issue[] = [];
    const mappingById = new Map(changeSet.mappings.map((m) => [m.elementId, m]));
    for (const change of changeSet.changes) {
      const layerId = layerIdOf(mappingById.get(change.elementId)!.native);
      const element = elements.find((e) => layerIdOf(e.native) === layerId);
      const actual = element?.properties.find((p) => p.type === change.property.type);
      if (!actual || !propertyValuesEqual(actual, change.property)) {
        issues.push({
          code: "APPLICATION_ERROR",
          message: `Photoshop did not apply ${change.property.type} as requested`,
          elementId: change.elementId,
          property: change.property.type,
          details: { requested: change.property.value, actual: actual?.value },
        });
      }
    }
    if (issues.length) throw new ConnectorError(issues);
  }
}
