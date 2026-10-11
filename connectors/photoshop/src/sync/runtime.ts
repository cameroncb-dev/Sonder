import { type AssetRef, ConnectorError } from "@sonder/connector-sdk";
import type { ConnectorJob, PairStartResponse } from "@sonder/contracts";
import { app } from "photoshop";

import { type PhotoshopCheckpoint, PhotoshopConnector } from "../connector";
import { getFile, getOrCreateFolder, readBytes } from "../ps/files";
import { ApiError, SonderApi } from "./api";
import * as ledger from "./ledger";
import { connectorFolder, load, save } from "./store";

const TICK_MS = 3000;

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
  assets: Array<{ assetId: string; projectId: string; path: string }>;
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
  const docs: Array<{ path: string; name: string; id: number }> = [];
  for (let i = 0; i < app.documents.length; i++) {
    const doc = app.documents[i];
    const path = doc && documentPath(doc);
    if (doc && path) docs.push({ path, name: doc.name, id: doc.id });
  }
  return docs;
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
    this.session = undefined;
    this.pairing = undefined;
    await save("session.json", null);
    this.update({ connection: { state: "unpaired" }, assets: [] });
  }

  api(): SonderApi | undefined {
    return this.session ? new SonderApi(this.session.token) : undefined;
  }

  /** Development fault injection, used to verify recovery from interrupted jobs. */
  injectFault(stage: "before-finalize") {
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
    const heartbeat = await api.heartbeat(
      openDocuments().map(({ path, name }) => ({ path, name })),
    );
    this.update({ assets: heartbeat.assets, error: undefined });
    const { job } = await api.claim();
    if (job) await this.execute(api, job);
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
      return `paused before finalize (fault injection), uploaded ${uploaded}`;
    }

    await api.finalize(begin.checkpointId);
    await ledger.record({ operationId: job.operationId, checkpointId: begin.checkpointId });
    return `succeeded: checkpoint ${begin.checkpointId} (${reused ? "reused capture" : "new capture"}, uploaded ${uploaded})`;
  }
}
