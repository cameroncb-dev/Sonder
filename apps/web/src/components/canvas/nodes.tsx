"use client";

import { type Node, type NodeProps } from "@xyflow/react";

import { NoteCard, SectionCard, TextCard } from "./canvas-cards";
import { handles } from "./handles";
import { APPLICATION_LABELS, type CanvasAsset, OPERATION_LABELS } from "./types";

export type AssetNode = Node<{ asset: CanvasAsset; selected?: boolean }, "asset">;
export type ReferenceNode = Node<{ name: string; url: string | null }, "reference">;

/** What the connector reports about the open document, or null when there's nothing to flag. */
export function changeLabel(asset: CanvasAsset): string | null {
  const { online, unsaved, uncaptured } = asset.connector;
  if (!online) return null;
  if (unsaved) return "Unsaved changes in the app";
  if (uncaptured) return "Saved changes not captured yet";
  return null;
}

export function AssetCard({ data, selected }: NodeProps<AssetNode>) {
  const { asset } = data;
  const operations = asset.connector.capabilities?.operations ?? [];
  return (
    <div
      className={`w-64 rounded-lg border bg-white shadow-sm dark:bg-zinc-900 ${
        selected
          ? "border-blue-500 ring-2 ring-blue-500/30"
          : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      {handles}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <span className="truncate text-sm font-medium" title={asset.name}>
          {asset.name}
        </span>
        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          {APPLICATION_LABELS[asset.application] ?? asset.application}
        </span>
      </div>
      <div className="flex aspect-[4/3] items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        {asset.headPreviewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img
            src={asset.headPreviewUrl}
            alt={`${asset.name} preview`}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-xs text-zinc-400">No checkpoints yet</span>
        )}
      </div>
      <div className="space-y-1.5 px-3 py-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">Branch</span>
          <span className="font-mono">{asset.activeBranch?.name ?? "—"}</span>
        </div>
        {changeLabel(asset) && (
          <div className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {changeLabel(asset)}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">Connector</span>
          <span className="flex items-center gap-1">
            <span
              className={`h-2 w-2 rounded-full ${asset.connector.online ? "bg-green-500" : "bg-zinc-400"}`}
            />
            {asset.connector.online ? "open in app" : "offline"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1 pt-1">
          {operations
            .filter((op) => OPERATION_LABELS[op])
            .map((op) => (
              <span
                key={op}
                className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {OPERATION_LABELS[op]}
              </span>
            ))}
          {!operations.length && (
            <span className="text-[10px] text-zinc-400">No connector capabilities reported</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReferenceCard({ data, selected }: NodeProps<ReferenceNode>) {
  return (
    <div
      className={`w-56 overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-zinc-900 ${selected ? "border-blue-500" : "border-zinc-200 dark:border-zinc-700"}`}
    >
      {handles}
      {data.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
        <img src={data.url} alt={data.name} className="block max-h-56 w-full object-contain" />
      ) : (
        <div className="p-4 text-xs text-zinc-400">Image unavailable</div>
      )}
      <div className="truncate px-2 py-1 text-xs text-zinc-500">Reference · {data.name}</div>
    </div>
  );
}

export const nodeTypes = {
  asset: AssetCard,
  note: NoteCard,
  text: TextCard,
  section: SectionCard,
  reference: ReferenceCard,
};
