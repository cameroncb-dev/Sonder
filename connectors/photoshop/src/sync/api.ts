import {
  CheckpointBeginResponse,
  type CheckpointBeginRequest,
  CheckpointElementsResponse,
  ClaimResponse,
  type ConnectorManifest,
  type HeartbeatRequest,
  HeartbeatResponse,
  PairPollResponse,
  PairStartResponse,
} from "@sonder/contracts";
import type { z } from "zod";

export const BACKEND_URL = "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: {
    method?: string;
    token?: string;
    json?: unknown;
    body?: ArrayBuffer;
    contentType?: string;
  },
  schema?: z.ZodType<T>,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  if (init.body) headers["content-type"] = init.contentType ?? "application/octet-stream";
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(
      response.status,
      error?.code ?? "HTTP_ERROR",
      error?.message ?? `HTTP ${response.status}`,
    );
  }
  return schema ? schema.parse(body) : (body as T);
}

/** Typed client for the connector endpoints. The token is the only credential the plugin holds. */
export class SonderApi {
  constructor(private readonly token?: string) {}

  static pairStart(manifest: ConnectorManifest) {
    return request("/api/connector/pair/start", { json: { manifest } }, PairStartResponse);
  }

  static pairPoll(sessionId: string, pollSecret: string) {
    return request(
      "/api/connector/pair/poll",
      { json: { sessionId, pollSecret } },
      PairPollResponse,
    );
  }

  heartbeat(openDocuments: HeartbeatRequest["openDocuments"]) {
    return request(
      "/api/connector/heartbeat",
      { token: this.token, json: { openDocuments } },
      HeartbeatResponse,
    );
  }

  /** Revokes this session's token on the server. */
  disconnect() {
    return request("/api/connector/disconnect", { token: this.token });
  }

  checkpointElements(checkpointId: string) {
    return request(
      `/api/connector/checkpoints/${checkpointId}/elements`,
      { method: "GET", token: this.token },
      CheckpointElementsResponse,
    );
  }

  projects() {
    return request<{ projects: Array<{ id: string; name: string; role: string }> }>(
      "/api/connector/projects",
      {
        method: "GET",
        token: this.token,
      },
    );
  }

  linkAsset(projectId: string, name: string, path: string) {
    return request<{ asset: { id: string; name: string; project_id: string } }>(
      "/api/connector/assets",
      {
        token: this.token,
        json: { projectId, name, path },
      },
    );
  }

  claim() {
    return request("/api/connector/jobs/claim", { token: this.token, json: {} }, ClaimResponse);
  }

  complete(jobId: string, result: Record<string, unknown>) {
    return request(`/api/connector/jobs/${jobId}/complete`, {
      token: this.token,
      json: { result },
    });
  }

  fail(
    jobId: string,
    error: { code: string; message: string; issues?: unknown[] },
    retryable: boolean,
  ) {
    return request(`/api/connector/jobs/${jobId}/fail`, {
      token: this.token,
      json: { error, retryable },
    });
  }

  beginCheckpoint(body: CheckpointBeginRequest) {
    return request(
      "/api/connector/checkpoints",
      { token: this.token, json: body },
      CheckpointBeginResponse,
    );
  }

  uploadFile(
    checkpointId: string,
    kind: "native" | "preview",
    bytes: Uint8Array,
    contentType: string,
  ) {
    return request(`/api/connector/checkpoints/${checkpointId}/files/${kind}`, {
      method: "PUT",
      token: this.token,
      body: bytes.slice().buffer,
      contentType,
    });
  }

  /** Native snapshot bytes of a finalized checkpoint. */
  async downloadCheckpoint(checkpointId: string): Promise<Uint8Array> {
    const response = await fetch(
      `${BACKEND_URL}/api/connector/checkpoints/${checkpointId}/download`,
      {
        headers: { authorization: `Bearer ${this.token}` },
      },
    );
    if (!response.ok)
      throw new ApiError(
        response.status,
        "DOWNLOAD_FAILED",
        `Snapshot download failed (HTTP ${response.status})`,
      );
    return new Uint8Array(await response.arrayBuffer());
  }

  finalize(checkpointId: string) {
    return request<{ checkpointId: string; status: string }>(
      `/api/connector/checkpoints/${checkpointId}/finalize`,
      { token: this.token, json: {} },
    );
  }
}
