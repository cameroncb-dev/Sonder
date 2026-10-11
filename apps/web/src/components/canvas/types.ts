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
  item_type: "asset" | "reference" | "note" | "direction" | "theme";
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
