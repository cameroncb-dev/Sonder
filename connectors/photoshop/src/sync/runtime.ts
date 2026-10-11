import { type AssetRef, ConnectorError, diffElements, fnv1a64 } from "@sonder/connector-sdk";
import {
  ChangeSet,
  CheckpointManifest,
  type ConnectorJob,
  type Element,
  type HeartbeatResponse,
  type PairStartResponse,
} from "@sonder/contracts";
import { action, app, constants, core } from "photoshop";

import { type PhotoshopCheckpoint, PhotoshopConnector } from "../connector";
import { elementKey } from "../core/identity";
import { findDocument } from "../ps/elements";
import {
  asPsEntry,
  type Folder,
  getFile,
  getOrCreateFolder,
  readBytes,
  writeBytes,
} from "../ps/files";
import { ApiError, SonderApi } from "./api";
import * as ledger from "./ledger";
import { connectorFolder, load, save } from "./store";

const TICK_MS = 3000;
const CHECK_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error: unknown) => (clearTimeout(timer), reject(error)),
    );
  });
}

interface StoredSession {
  token: string;
  expiresAt: string;
  user: { id: string; email?: string };
}

export type ConnectionState =
  | { state: "unpaired" }
  | { state: "pairing"; code: string; expiresAt: string }
  | { state: "active"; user: StoredSession["user"]; expiresAt: string }
  | { state: "expired"; reason: string };

export interface RuntimeStatus {
  connection: ConnectionState;
  assets: HeartbeatResponse["assets"];
  /** Open files that a tracked document used before; edits there aren't captured. */
  former?: NonNullable<HeartbeatResponse["formerDocuments"]>;
  lastJob?: {
    id: string;
    operation: string;
    operationId: string;
    attempt: number;
    outcome: string;
    at: string;
  };
  error?: string;
  updatedAt: string;
}

/** Full path of a saved document, or undefined for unsaved documents. */
export function documentPath(doc: { path: string; name: string }): string | undefined {
  if (!doc.path) return undefined;
  return doc.path.endsWith(doc.name) ? doc.path : `${doc.path.replace(/\/$/, "")}/${doc.name}`;
}

function openDocuments() {
  const docs: Array<{ path: string; name: string; id: number; saved: boolean }> = [];
  for (let i = 0; i < app.documents.length; i++) {
    const doc = app.documents[i];
    const path = doc && documentPath(doc);
    if (doc && path) docs.push({ path, name: doc.name, id: doc.id, saved: doc.saved });
  }
  return docs;
}

/** Whether a saved open document differs from its reference checkpoint (`against`). */
interface ChangeCheck {
  docId: number;
  against: string;
  uncaptured: boolean;
}

/**
 * Pairs with the backend and, while the panel is open, reports open documents,
 * claims compatible jobs and runs them through the connector contract.
 */
export class ConnectorRuntime {
  private readonly connector = new PhotoshopConnector();
  private session?: StoredSession;
  private pairing?: PairStartResponse;
  private busy = false;
  private readonly faults = new Set<string>();
  private readonly listeners = new Set<(status: RuntimeStatus) => void>();
  /** Head of each linked document's active branch, from the last heartbeat (keyed by path). */
  private heads = new Map<string, string | null>();
  /** Latest comparison per path; dropped when the document is saved so it is checked again. */
  private readonly checks = new Map<string, ChangeCheck>();
  private readonly headElements = new Map<string, Element[]>();
  /**
   * Checkpoint each open file was last opened from or captured as, keyed by path. Changes
   * are judged against it rather than the branch head, which can move ahead of the open
   * file (e.g. when a combination is approved onto its branch).
   */
  private baselines = new Map<string, string>();
  status: RuntimeStatus = {
    connection: { state: "unpaired" },
    assets: [],
    updatedAt: new Date().toISOString(),
  };

  onChange(listener: (status: RuntimeStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
  }

  private update(patch: Partial<RuntimeStatus>) {
    this.status = { ...this.status, ...patch, updatedAt: new Date().toISOString() };
    for (const listener of this.listeners) listener(this.status);
    void save("status.json", this.status);
  }

  async start() {
    this.baselines = new Map(
      Object.entries(await load<Record<string, string>>("baselines.json", {})),
    );
    const stored = await load<StoredSession | null>("session.json", null);
    if (stored && new Date(stored.expiresAt).getTime() > Date.now()) {
      this.session = stored;
      this.update({
        connection: { state: "active", user: stored.user, expiresAt: stored.expiresAt },
      });
    } else if (stored) {
      this.update({ connection: { state: "expired", reason: "Session expired; connect again" } });
    }
    setInterval(() => void this.tick(), TICK_MS);
    // A save changes what is on disk, so recheck it against its reference checkpoint.
    void action.addNotificationListener(["save"], () => this.checks.clear());
  }

  async pair() {
    this.pairing = await SonderApi.pairStart(this.connector.manifest());
    this.session = undefined;
    await save("session.json", null);
    this.update({
      connection: { state: "pairing", code: this.pairing.code, expiresAt: this.pairing.expiresAt },
      error: undefined,
    });
  }

  async disconnect() {
    // End the session on the server too, so the token can't be used again. Best effort: if
    // the backend is unreachable, the token still expires on its own.
    const api = this.api();
    if (api) await api.disconnect().catch(() => undefined);
    this.session = undefined;
    this.pairing = undefined;
    await save("session.json", null);
    this.update({ connection: { state: "unpaired" }, assets: [], former: [] });
  }

  private async setBaseline(path: string, checkpointId: string) {
    this.baselines.set(path, checkpointId);
    this.checks.delete(path);
    await save("baselines.json", Object.fromEntries(this.baselines));
  }

  /** Elements of a checkpoint, cached (finalized checkpoints never change). */
  private async elementsOf(api: SonderApi, checkpointId: string): Promise<Element[]> {
    let elements = this.headElements.get(checkpointId);
    if (!elements) {
      elements = (await api.checkpointElements(checkpointId)).elements;
      this.headElements.set(checkpointId, elements);
    }
    return elements;
  }

  /** What an open file is compared with: its baseline, else its branch head. */
  private reference(path: string): string | undefined {
    return this.baselines.get(path) ?? this.heads.get(path) ?? undefined;
  }

  /**
   * Development: set the current connection aside so a test can pair as someone else, then
   * put it back afterwards. The stashed token is never sent anywhere while set aside.
   */
  async stashSession() {
    await save("session.stash.json", this.session ?? null);
    return { stashed: !!this.session };
  }

  async restoreSession() {
    const stored = await load<StoredSession | null>("session.stash.json", null);
    await save("session.stash.json", null);
    if (!stored || new Date(stored.expiresAt).getTime() <= Date.now()) return { restored: false };
    this.pairing = undefined;
    this.session = stored;
    await save("session.json", stored);
    this.update({
      connection: { state: "active", user: stored.user, expiresAt: stored.expiresAt },
      error: undefined,
    });
    return { restored: true };
  }

  api(): SonderApi | undefined {
    return this.session ? new SonderApi(this.session.token) : undefined;
  }

  /**
   * Brings the file Sonder tracks for a document to the front. Returns false when it isn't
   * open (then the user switches branches from the canvas, which opens it).
   */
  async showTrackedCopy(path: string): Promise<boolean> {
    const doc = openDocuments().find((d) => d.path === path);
    const target = doc && findDocument(doc.id);
    if (!target) return false;
    await core.executeAsModal(
      async () => {
        app.activeDocument = target;
      },
      { commandName: "Sonder: show tracked copy" },
    );
    return true;
  }

  /** Development fault injection, used to verify recovery from interrupted jobs. */
  injectFault(stage: "before-finalize" | "fail-candidate") {
    this.faults.add(stage);
  }

  async linkActiveDocument(projectId: string) {
    const api = this.api();
    const doc = app.activeDocument;
    const path = doc && documentPath(doc);
    if (!api) throw new Error("Connect to Sonder first");
    if (!doc || !path) throw new Error("Save the document before linking it");
    const { asset } = await api.linkAsset(projectId, doc.name, path);
    await this.tick();
    return asset;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.pairing) await this.pollPairing();
      if (this.session) await this.work();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.session = undefined;
        await save("session.json", null);
        this.update({ connection: { state: "expired", reason: error.message }, assets: [] });
      } else {
        this.update({ error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      this.busy = false;
    }
  }

  private async pollPairing() {
    const pairing = this.pairing!;
    const result = await SonderApi.pairPoll(pairing.sessionId, pairing.pollSecret);
    if (result.status === "pending") return;
    this.pairing = undefined;
    if (result.status === "expired") {
      this.update({
        connection: { state: "expired", reason: "Pairing code expired; connect again" },
      });
      return;
    }
    this.session = { token: result.token, expiresAt: result.expiresAt, user: result.user };
    await save("session.json", this.session);
    this.update({
      connection: { state: "active", user: result.user, expiresAt: result.expiresAt },
      error: undefined,
    });
  }

  private async work() {
    const api = this.api()!;
    const docs = openDocuments();
    const heartbeat = await api.heartbeat(
      docs.map(({ path, name, id, saved }) => {
        const check = this.checks.get(path);
        const current = check && check.docId === id && check.against === this.reference(path);
        return {
          path,
          name,
          unsaved: !saved,
          ...(saved && current ? { uncaptured: check.uncaptured } : {}),
        };
      }),
    );
    this.heads = new Map(heartbeat.assets.map((a) => [a.path, a.headCheckpointId ?? null]));
    this.update({
      assets: heartbeat.assets,
      former: heartbeat.formerDocuments ?? [],
      error: undefined,
    });
    const { job } = await api.claim();
    if (job) {
      await this.execute(api, job);
      this.checks.clear();
    } else {
      await this.checkForChanges(api, docs);
    }
  }

  /**
   * Compares saved linked documents with their branch heads, at most one per tick and only when
   * something changed (a save, a new head, a different open document). Reported on the next tick.
   */
  private async checkForChanges(api: SonderApi, docs: ReturnType<typeof openDocuments>) {
    for (const doc of docs) {
      // Only linked documents with history have something to compare with.
      if (!doc.saved || !this.heads.get(doc.path)) continue;
      const head = this.reference(doc.path)!;
      const check = this.checks.get(doc.path);
      if (check && check.docId === doc.id && check.against === head) continue;
      try {
        const expected = await this.elementsOf(api, head);
        // Bounded so a read Photoshop never answers cannot stall heartbeats and job claims.
        const { elements } = await withTimeout(
          this.connector.readProperties({ id: String(doc.id), name: doc.name }),
          CHECK_TIMEOUT_MS,
        );
        const uncaptured = diffElements(expected, elements, elementKey).length > 0;
        this.checks.set(doc.path, { docId: doc.id, against: head, uncaptured });
      } catch {
        // Photoshop may refuse reads while busy (e.g. editing text); try again next tick.
      }
      return;
    }
  }

  private async execute(api: SonderApi, job: ConnectorJob) {
    const report = (outcome: string) =>
      this.update({
        lastJob: {
          id: job.id,
          operation: job.operation,
          operationId: job.operationId,
          attempt: job.attempt,
          outcome,
          at: new Date().toISOString(),
        },
      });

    // Repeated delivery of an operation this plugin already finished: re-report, don't redo.
    const done = await ledger.lookup(job.operationId);
    if (done?.checkpointId) {
      await api.finalize(done.checkpointId);
      return report("re-reported from ledger");
    }
    if (done?.result) {
      await api.complete(job.id, done.result);
      return report("re-reported from ledger");
    }

    try {
      switch (job.operation) {
        case "captureCheckpoint":
          return report(await this.capture(api, job));
        case "openCheckpoint":
          return report(await this.checkout(api, job));
        case "createCandidate":
          return report(await this.candidate(api, job));
        case "readProperties": {
          const result = await this.connector.readProperties(this.assetFor(job));
          await ledger.record({ operationId: job.operationId, result });
          await api.complete(job.id, result);
          return report("succeeded");
        }
        default:
          await api.fail(
            job.id,
            { code: "UNSUPPORTED_OPERATION", message: `Unsupported operation ${job.operation}` },
            false,
          );
          return report("failed: unsupported operation");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409)
        return report(`dropped: ${error.message}`);
      if (error instanceof ApiError && error.status === 401) throw error;
      const connectorError = error instanceof ConnectorError ? error : undefined;
      const retryable = !connectorError || connectorError.code === "NO_DOCUMENT";
      const message = error instanceof Error ? error.message : String(error);
      await api.fail(
        job.id,
        {
          code: connectorError?.code ?? "APPLICATION_ERROR",
          message,
          ...(connectorError ? { issues: connectorError.issues } : {}),
        },
        retryable,
      );
      return report(`failed: ${message}`);
    }
  }

  /** The open document for a job's asset, matched by path. */
  private assetFor(job: ConnectorJob): AssetRef {
    const path = typeof job.assetLocator?.path === "string" ? job.assetLocator.path : undefined;
    const doc = openDocuments().find((d) => d.path === path);
    if (!doc) {
      throw new ConnectorError({
        code: "NO_DOCUMENT",
        message: `The document for this asset (${path ?? "unknown"}) is not open`,
      });
    }
    return { id: String(doc.id), name: doc.name };
  }

  /**
   * Opens a branch head as a Sonder-managed working copy and reports its path.
   * Refuses (non-retryable) when the open document has unsaved changes or
   * changes that were never captured, so switching branches never loses work.
   */
  private async checkout(api: SonderApi, job: ConnectorJob): Promise<string> {
    const params = job.params as {
      branchId: string;
      branchName: string;
      assetName?: string;
      checkpointId: string;
      native: { name: string; bytes: number; digest: string };
      currentHeadElements: Element[] | null;
      force?: boolean;
    };
    const currentPath =
      typeof job.assetLocator?.path === "string" ? job.assetLocator.path : undefined;
    const open = openDocuments().find((d) => d.path === currentPath);
    const openDoc = open ? findDocument(open.id) : undefined;

    if (openDoc) {
      if (!openDoc.saved) {
        throw new ConnectorError({
          code: "UNSAVED_CHANGES",
          message: `"${openDoc.name}" has unsaved changes. Save and capture it before switching branches.`,
        });
      }
      const baseline = currentPath ? this.baselines.get(currentPath) : undefined;
      const expected = baseline ? await this.elementsOf(api, baseline) : params.currentHeadElements;
      if (!params.force && expected) {
        const { elements } = await this.connector.readProperties({
          id: String(openDoc.id),
          name: openDoc.name,
        });
        const differences = diffElements(expected, elements, elementKey);
        if (differences.length) {
          throw new ConnectorError({
            code: "UNCAPTURED_CHANGES",
            message: `"${openDoc.name}" has changes that were never captured. Capture them first, or use Switch anyway.`,
            details: { differences },
          });
        }
      }
    }

    const bytes = await api.downloadCheckpoint(params.checkpointId);
    if (bytes.length !== params.native.bytes || fnv1a64(bytes) !== params.native.digest) {
      throw new ConnectorError({
        code: "CHECKPOINT_INCOMPLETE",
        message: "Downloaded snapshot does not match its manifest",
      });
    }
    // One folder per switch keeps paths unique, so the file name can stay readable in
    // Photoshop's tab: "Sonder-Test - font.psd".
    const working = await getOrCreateFolder(
      await getOrCreateFolder(
        await getOrCreateFolder(await connectorFolder(), "working"),
        job.assetId ?? "unknown",
      ),
      String(Date.now()),
    );
    const clean = (text: string) =>
      text
        .replace(/[\\/:*?"<>|]+/g, "_")
        .trim()
        .slice(0, 60);
    const base = clean((params.assetName ?? "Document").replace(/\.psd$/i, "")) || "Document";
    const file = await writeBytes(
      working,
      `${base} - ${clean(params.branchName) || "branch"}.psd`,
      bytes,
    );

    const opened = await core.executeAsModal(
      async () => {
        // Saved and captured (checked above), so closing loses nothing.
        if (openDoc) await openDoc.close(constants.SaveOptions.DONOTSAVECHANGES);
        return app.open(asPsEntry(file));
      },
      { commandName: `Sonder: switch to ${params.branchName}` },
    );
    const path = documentPath(opened) ?? file.nativePath;
    const result = { path, branchId: params.branchId, checkpointId: params.checkpointId };
    await this.setBaseline(path, params.checkpointId);
    await ledger.record({ operationId: job.operationId, result });
    await api.complete(job.id, result);
    return `switched to ${params.branchName}`;
  }

  private async capture(api: SonderApi, job: ConnectorJob): Promise<string> {
    const jobs = await getOrCreateFolder(await connectorFolder(), "jobs");
    const folder = await getOrCreateFolder(jobs, job.operationId);

    // A retried operation reuses its first capture so uploads always match one manifest.
    let checkpoint: PhotoshopCheckpoint;
    let reused = true;
    try {
      checkpoint = await this.connector.loadCheckpoint(folder, "checkpoint");
    } catch {
      reused = false;
      checkpoint = await this.connector.captureCheckpoint(this.assetFor(job), folder, "checkpoint");
    }

    const { checkpointId, summary } = await this.upload(api, job, checkpoint, folder);
    const path = typeof job.assetLocator?.path === "string" ? job.assetLocator.path : undefined;
    if (checkpointId && path) await this.setBaseline(path, checkpointId);
    return `${summary} (${reused ? "reused capture" : "new capture"})`;
  }

  /**
   * Builds a combination candidate: applies the job's change set to a copy of the target
   * checkpoint's snapshot (never the open document) and uploads the result with its preview.
   * Parents and proposal links are set by the backend from the job, not by the plugin.
   */
  private async candidate(api: SonderApi, job: ConnectorJob): Promise<string> {
    const params = job.params as {
      targetCheckpoint: { id: string; manifest: unknown };
      changeSet: unknown;
    };
    const jobs = await getOrCreateFolder(await connectorFolder(), "jobs");
    const folder = await getOrCreateFolder(jobs, job.operationId);

    if (this.faults.delete("fail-candidate"))
      throw new ConnectorError({
        code: "APPLICATION_ERROR",
        message: "Simulated failure while building the candidate (fault injection)",
      });

    let checkpoint: PhotoshopCheckpoint;
    let reused = true;
    try {
      checkpoint = await this.connector.loadCheckpoint(folder, "candidate");
    } catch {
      reused = false;
      const manifest = CheckpointManifest.parse(params.targetCheckpoint.manifest);
      const changeSet = ChangeSet.parse(params.changeSet);
      const bytes = await api.downloadCheckpoint(params.targetCheckpoint.id);
      const native = manifest.files.native;
      if (bytes.length !== native.bytes || fnv1a64(bytes) !== native.digest) {
        throw new ConnectorError({
          code: "CHECKPOINT_INCOMPLETE",
          message: "Downloaded snapshot does not match its manifest",
        });
      }
      const source = await getOrCreateFolder(folder, "source");
      await writeBytes(source, native.name, bytes);
      checkpoint = await this.connector.createCandidate(
        { manifest, location: source },
        changeSet,
        folder,
        "candidate",
      );
    }
    const { summary } = await this.upload(api, job, checkpoint, folder);
    return `${summary} (${reused ? "reused candidate" : "new candidate"})`;
  }

  /** Uploads a local checkpoint for a job and finalizes it; resumes partial uploads. */
  private async upload(
    api: SonderApi,
    job: ConnectorJob,
    checkpoint: PhotoshopCheckpoint,
    folder: Folder,
  ): Promise<{ checkpointId?: string; summary: string }> {
    const message = typeof job.params.message === "string" ? job.params.message : undefined;
    const begin = await api.beginCheckpoint({
      jobId: job.id,
      manifest: checkpoint.manifest,
      parentIds: [],
      ...(message ? { message } : {}),
    });

    const files = checkpoint.manifest.files;
    let uploaded = 0;
    for (const kind of ["native", "preview"] as const) {
      if (begin.storedFiles.includes(kind)) continue;
      const bytes = await readBytes(await getFile(folder, files[kind].name));
      await api.uploadFile(begin.checkpointId, kind, bytes, files[kind].mediaType);
      uploaded++;
    }

    if (this.faults.delete("before-finalize")) {
      return { summary: `paused before finalize (fault injection), uploaded ${uploaded}` };
    }

    await api.finalize(begin.checkpointId);
    await ledger.record({ operationId: job.operationId, checkpointId: begin.checkpointId });
    return {
      checkpointId: begin.checkpointId,
      summary: `succeeded: checkpoint ${begin.checkpointId}, uploaded ${uploaded}`,
    };
  }
}
