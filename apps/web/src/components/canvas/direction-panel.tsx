"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";

import { handles } from "./handles";
import type { CanvasAsset, CanvasDirection, DirectionDetail, History } from "./types";

export type DirectionNode = Node<{ direction: CanvasDirection }, "direction">;

/** A saved direction on the canvas: its name and a thumbnail per document. */
export function DirectionCard({ data, selected }: NodeProps<DirectionNode>) {
  const { direction } = data;
  return (
    <div
      className={`w-64 rounded-lg border bg-white p-3 shadow-sm dark:bg-zinc-900 ${selected ? "border-blue-500 ring-2 ring-blue-500/30" : "border-zinc-200 dark:border-zinc-700"}`}
    >
      {handles}
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{direction.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Direction</span>
      </div>
      {direction.description && (
        <p className="mb-2 line-clamp-2 text-xs text-zinc-500">{direction.description}</p>
      )}
      <div className="grid grid-cols-3 gap-1">
        {direction.previews.map((p) =>
          p.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img
              key={p.assetId}
              src={p.url}
              alt=""
              className="aspect-[4/3] w-full rounded border border-zinc-200 object-cover dark:border-zinc-700"
            />
          ) : (
            <div key={p.assetId} className="aspect-[4/3] rounded bg-zinc-100 dark:bg-zinc-800" />
          ),
        )}
      </div>
      <p className="mt-1 text-[10px] text-zinc-500">
        {direction.previews.length} {direction.previews.length === 1 ? "document" : "documents"} ·
        exact versions
      </p>
    </div>
  );
}

const heading = "text-xs font-semibold uppercase tracking-wide text-zinc-500";
const primaryButton =
  "rounded bg-zinc-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-black";
const smallButton =
  "rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700";

/** One direction: which exact version of each document it holds, and reopening them. */
export function DirectionPanel({
  projectId,
  directionId,
  onClose,
  onDelete,
  onChanged,
}: {
  projectId: string;
  directionId: string;
  onClose: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const base = `/api/projects/${projectId}/directions/${directionId}`;
  const [detail, setDetail] = useState<DirectionDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<DirectionDetail>("GET", base)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setNotice(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [base, reloadKey]);

  async function open(assetIds?: string[]) {
    setBusy(true);
    setNotice(null);
    try {
      const { opened } = await api<{ opened: Array<{ assetName: string; branchName: string }> }>(
        "POST",
        `${base}/open`,
        assetIds ? { assetIds } : {},
      );
      setNotice(
        `Opening ${opened.map((o) => `${o.assetName} (branch ${o.branchName})`).join(", ")}. ` +
          "Check each document's Recent activity if one refuses because of unsaved or uncaptured work.",
      );
      onChanged();
      setTimeout(() => setReloadKey((k) => k + 1), 4000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!detail)
    return (
      <aside className="w-96 shrink-0 border-l border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
        {notice ?? "Loading direction…"}
      </aside>
    );
  const canEdit = detail.role !== "reviewer";

  return (
    <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{detail.direction.name}</h2>
          <p className="text-xs text-zinc-500">
            Direction · saved {new Date(detail.direction.createdAt).toLocaleString()}
          </p>
        </div>
        <button
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={onClose}
          aria-label="Close direction"
        >
          ✕
        </button>
      </header>
      {detail.direction.description && <p className="text-sm">{detail.direction.description}</p>}
      <p className="text-[11px] leading-snug text-zinc-500">
        Exact versions of each document, kept as they were saved even as branches move on. Opening
        puts each document on a branch at its saved version.
      </p>

      <section className="flex flex-col gap-2">
        <h3 className={heading}>Documents</h3>
        {detail.entries.map((e) => (
          <div
            key={e.assetId}
            className="flex gap-2 rounded border border-zinc-200 p-2 dark:border-zinc-800"
          >
            {e.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={e.previewUrl} alt="" className="h-14 w-20 shrink-0 rounded object-cover" />
            ) : (
              <div className="h-14 w-20 shrink-0 rounded bg-zinc-100 dark:bg-zinc-800" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{e.assetName}</div>
              <div className="truncate text-xs text-zinc-500">
                {e.message ?? "Checkpoint"}
                {e.createdAt ? ` · ${new Date(e.createdAt).toLocaleString()}` : ""}
              </div>
              <div className="text-[11px] text-zinc-500">
                {e.isCurrent
                  ? `Current version on ${e.activeBranch}`
                  : `Moved on since (now on ${e.activeBranch ?? "no branch"})`}
              </div>
            </div>
            {canEdit && (
              <button
                className={`${smallButton} self-center`}
                disabled={busy}
                onClick={() => void open([e.assetId])}
              >
                Open
              </button>
            )}
          </div>
        ))}
      </section>

      {canEdit && (
        <button className={primaryButton} disabled={busy} onClick={() => void open()}>
          Open all in the app
        </button>
      )}
      {notice && <p className="text-xs text-zinc-600 dark:text-zinc-400">{notice}</p>}
      {canEdit && (
        <section className="mt-auto border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <button className="text-xs text-zinc-500 hover:text-red-600" onClick={onDelete}>
            Delete direction
          </button>
        </section>
      )}
    </aside>
  );
}

/**
 * Chooses the exact version of each document for a new direction. Each starts at its active
 * branch's newest version; documents can be left out.
 */
export function DirectionPicker({
  projectId,
  assets,
  name,
  onCancel,
  onConfirm,
}: {
  projectId: string;
  assets: CanvasAsset[];
  name: string;
  onCancel: () => void;
  onConfirm: (entries: Array<{ assetId: string; checkpointId: string }>) => void;
}) {
  const [histories, setHistories] = useState<Record<string, History>>({});
  const [chosen, setChosen] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    for (const asset of assets)
      void api<History>("GET", `/api/projects/${projectId}/assets/${asset.id}/history`)
        .then((h) => !cancelled && setHistories((s) => ({ ...s, [asset.id]: h })))
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, assets]);

  const choice = (asset: CanvasAsset) =>
    asset.id in chosen ? chosen[asset.id] : (asset.activeBranch?.headCheckpointId ?? null);
  const entries = assets
    .map((a) => ({ assetId: a.id, checkpointId: choice(a) }))
    .filter((e): e is { assetId: string; checkpointId: string } => !!e.checkpointId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-auto rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold">Versions for &ldquo;{name}&rdquo;</h2>
        <p className="text-xs text-zinc-500">
          Pick the exact version of each document. Each starts at its current branch&apos;s newest
          version. These are kept as they are, even as you keep working.
        </p>
        {assets.map((asset) => {
          const history = histories[asset.id];
          const value = choice(asset);
          return (
            <label key={asset.id} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{asset.name}</span>
              <select
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                value={value ?? ""}
                disabled={!history}
                onChange={(e) => setChosen((s) => ({ ...s, [asset.id]: e.target.value || null }))}
              >
                <option value="">Leave out</option>
                {[...(history?.checkpoints ?? [])].reverse().map((c) => {
                  const heads = history!.branches.filter((b) => b.head_checkpoint_id === c.id);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.message ?? "Checkpoint"} · {new Date(c.createdAt).toLocaleString()}
                      {heads.length ? ` · newest on ${heads.map((b) => b.name).join(", ")}` : ""}
                    </option>
                  );
                })}
              </select>
              {!asset.activeBranch && history?.checkpoints.length === 0 && (
                <span className="text-xs text-zinc-500">No checkpoints yet; capture it first.</span>
              )}
            </label>
          );
        })}
        <div className="flex justify-end gap-2">
          <button
            className="rounded bg-zinc-200 px-4 py-1.5 text-sm text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={!entries.length}
            onClick={() => onConfirm(entries)}
          >
            Save direction ({entries.length})
          </button>
        </div>
      </div>
    </div>
  );
}
