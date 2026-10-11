import { z } from "zod";

import { CheckpointManifest } from "./checkpoint";
import { ConnectorManifest } from "./connector";

/** Connector ↔ backend HTTP contract. All bodies are JSON unless noted. */

export const PairStartRequest = z.object({ manifest: ConnectorManifest });
export type PairStartRequest = z.infer<typeof PairStartRequest>;

export const PairStartResponse = z.object({
  sessionId: z.uuid(),
  /** Shown to the user, who enters it in the web app. */
  code: z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
  /** Proves the poller is the device that started pairing. Never shown to users. */
  pollSecret: z.string().min(32),
  expiresAt: z.iso.datetime(),
});
export type PairStartResponse = z.infer<typeof PairStartResponse>;

export const PairPollRequest = z.object({ sessionId: z.uuid(), pollSecret: z.string().min(32) });
export type PairPollRequest = z.infer<typeof PairPollRequest>;

export const PairPollResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("expired") }),
  z.object({
    status: z.literal("active"),
    token: z.string().min(32),
    expiresAt: z.iso.datetime(),
    user: z.object({ id: z.uuid(), email: z.string().optional() }),
  }),
]);
export type PairPollResponse = z.infer<typeof PairPollResponse>;

export const PairApproveRequest = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
});

export const OpenDocument = z.object({
  path: z.string().min(1).max(4096),
  name: z.string().max(300),
});
export const HeartbeatRequest = z.object({ openDocuments: z.array(OpenDocument).max(200) });
export type HeartbeatRequest = z.infer<typeof HeartbeatRequest>;

export const HeartbeatResponse = z.object({
  sessionExpiresAt: z.iso.datetime(),
  assets: z.array(z.object({ assetId: z.uuid(), projectId: z.uuid(), path: z.string() })),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponse>;

export const LinkAssetRequest = z.object({
  projectId: z.uuid(),
  name: z.string().min(1).max(300),
  path: z.string().min(1).max(4096),
});

export const ConnectorJob = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  assetId: z.uuid().nullable(),
  operation: z.string(),
  operationId: z.string(),
  params: z.record(z.string(), z.unknown()),
  attempt: z.number().int().positive(),
  leaseExpiresAt: z.iso.datetime({ offset: true }),
  /** Native locator of the target asset, e.g. its document path. */
  assetLocator: z.record(z.string(), z.unknown()).nullable(),
});
export type ConnectorJob = z.infer<typeof ConnectorJob>;

export const ClaimResponse = z.object({ job: ConnectorJob.nullable() });
export type ClaimResponse = z.infer<typeof ClaimResponse>;

export const JobCompleteRequest = z.object({ result: z.record(z.string(), z.unknown()) });
export const JobFailRequest = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.unknown()).optional(),
  }),
  retryable: z.boolean(),
});

export const CheckpointBeginRequest = z.object({
  jobId: z.uuid(),
  manifest: CheckpointManifest,
  parentIds: z.array(z.uuid()).max(16).default([]),
  message: z.string().max(500).optional(),
});
export type CheckpointBeginRequest = z.infer<typeof CheckpointBeginRequest>;

export const CheckpointBeginResponse = z.object({
  checkpointId: z.uuid(),
  status: z.enum(["pending", "finalized"]),
  /** File kinds already stored (repeated delivery resumes instead of re-uploading). */
  storedFiles: z.array(z.enum(["native", "preview"])),
});
export type CheckpointBeginResponse = z.infer<typeof CheckpointBeginResponse>;

/** Parameters for jobs the backend creates for connectors. */
export const CaptureCheckpointParams = z.object({ message: z.string().max(500).optional() });
