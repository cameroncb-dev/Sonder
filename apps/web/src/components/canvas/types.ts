export interface ConnectorStatus {
  online: boolean;
  lastSeenAt: string | null;
  /** Reported by the connector for the open document; null when offline or unknown. */
  unsaved: boolean | null;
  uncaptured: boolean | null;
  capabilities: {
    connectorVersion?: string;
    applicationVersion?: string;
    operations: string[];
    elementKinds: unknown[];
  } | null;
}

export interface CanvasAsset {
  id: string;
  name: string;
  application: string;
  path: string | null;
  activeBranch: { id: string; name: string; headCheckpointId: string } | null;
  headPreviewUrl: string | null;
  connector: ConnectorStatus;
}

export interface CanvasItem {
  id: string;
  item_type: "asset" | "reference" | "note" | "text" | "section" | "direction" | "theme";
  ref_id: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  content: Record<string, unknown>;
  version: number;
  url?: string | null;
}

export interface CanvasConnection {
  id: string;
  from_item_id: string;
  to_item_id: string;
  label: string | null;
}

export interface CanvasData {
  project: { id: string; name: string };
  role: "owner" | "editor" | "reviewer";
  assets: CanvasAsset[];
  items: CanvasItem[];
  connections: CanvasConnection[];
  themes: CanvasTheme[];
}

export type ColorRole = "primary" | "background" | "text" | "accent";
export const COLOR_ROLES: ColorRole[] = ["primary", "background", "text", "accent"];

export interface CanvasTheme {
  id: string;
  name: string;
  colors: Record<ColorRole, string>;
}

export interface ThemePlan {
  assetId: string;
  name: string;
  branchName: string | null;
  checkpointId: string | null;
  status: "ready" | "no_changes" | "no_mappings" | "unsupported";
  reasons: string[];
  changes: Array<{ element: string; role: ColorRole; property: string; from?: string; to: string }>;
}

export interface ThemeDetail {
  role: CanvasData["role"];
  theme: CanvasTheme;
  assets: Array<{
    id: string;
    name: string;
    branchName: string | null;
    colorMode: string | null;
    elements: Array<{
      key: string;
      native: Element["native"];
      name: string;
      kind: string;
      editable: boolean;
      color?: unknown;
      colorRole: ColorRole | null;
    }>;
  }>;
  plans: ThemePlan[];
}

export interface ThemeUpdate {
  id: string;
  status: Proposal["status"];
  createdAt: string;
  approvedAt: string | null;
  request: { themeName: string; colors: Record<ColorRole, string> };
  items: Array<{
    id: string;
    assetId: string;
    assetName: string;
    status: "pending" | "running" | "ready" | "approved" | "finalized" | "failed" | "excluded";
    outcome: { reason?: string; error?: Job["error"] } | null;
    candidateCheckpointId: string | null;
    candidatePreviewUrl: string | null;
    beforePreviewUrl: string | null;
  }>;
}

export interface Element {
  native: { connector: string; data: Record<string, unknown> };
  kind: string;
  name: string;
  properties: Array<{ type: string; value: unknown }>;
  editable: boolean;
}

export interface HistoryCheckpoint {
  id: string;
  message: string | null;
  createdAt: string;
  parents: string[];
  previewUrl: string | null;
  nativeBytes: number;
  /** True when text and colors equal the parent checkpoint's. */
  noPropertyChanges?: boolean;
  document: { name: string; width: number; height: number; colorMode: string } | null;
  elements: Element[];
}

export interface Branch {
  id: string;
  name: string;
  head_checkpoint_id: string;
}

export interface Job {
  id: string;
  operation: string;
  status: "queued" | "leased" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  params: Record<string, unknown>;
  error: { code?: string; message?: string; issues?: Array<{ message?: string }> } | null;
  result: Record<string, unknown> | null;
  created_at: string;
}

export interface History {
  role: CanvasData["role"];
  asset: {
    id: string;
    name: string;
    application: string;
    path: string | null;
    activeBranchId: string | null;
  };
  branches: Branch[];
  checkpoints: HistoryCheckpoint[];
  jobs: Job[];
}

/** Human labels for connector operations, shown as an asset's supported actions. */
export const OPERATION_LABELS: Record<string, string> = {
  captureCheckpoint: "Capture",
  openCheckpoint: "Switch branch",
  createCandidate: "Create candidate",
  generatePreview: "Preview",
  readProperties: "Read properties",
  validateProposal: "Validate",
};

export const APPLICATION_LABELS: Record<string, string> = { photoshop: "Photoshop" };

export function formatValue(value: unknown): string {
  if (value && typeof value === "object" && "postScriptName" in value)
    return String((value as { postScriptName: string }).postScriptName);
  return String(value);
}

export type Side = "target" | "source";

export interface CombineRow {
  id: string;
  key: string;
  kind: string;
  name: string;
  property: string;
  base?: unknown;
  target?: unknown;
  source?: unknown;
  status: "unchanged" | "target" | "source" | "both_same" | "conflict";
  supported: boolean;
  reason?: string;
  defaultSide: Side | null;
}

interface CheckpointSummary {
  id: string;
  message: string | null;
  createdAt: string;
}

export interface Combination {
  base: CheckpointSummary & { chosen: boolean };
  target: { branchId: string; branchName: string; checkpoint: CheckpointSummary };
  source: { branchId: string; branchName: string; checkpoint: CheckpointSummary };
  rows: CombineRow[];
  structural: Array<{ key: string; name: string; change: string }>;
}

export interface Proposal {
  id: string;
  status:
    | "draft"
    | "preparing"
    | "ready"
    | "approved"
    | "rejected"
    | "finalized"
    | "partially_failed"
    | "failed";
  request: {
    targetBranchId: string;
    targetBranchName: string;
    targetCheckpointId: string;
    sourceBranchId: string;
    sourceBranchName: string;
    sourceCheckpointId: string;
    baseCheckpointId: string;
    changeSet: {
      changes: Array<{ elementId: string; property: { type: string; value: unknown } }>;
    };
  };
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  item: {
    id: string;
    status: string;
    outcome: { error?: Job["error"]; approvedCandidateId?: string } | null;
  };
  candidate: {
    id: string;
    previewUrl: string | null;
    previewDigest: string;
    elements: Element[];
  } | null;
}

/** Readable name for a proposal's state. */
export const PROPOSAL_STATUS: Record<Proposal["status"], string> = {
  draft: "Draft",
  preparing: "Building candidate…",
  ready: "Ready for review",
  approved: "Approved",
  rejected: "Discarded",
  finalized: "Approved and finalized",
  partially_failed: "Partly failed",
  failed: "Failed",
};
