"use client";

import { useEffect, useRef, useState } from "react";

import { api, ApiClientError } from "@/lib/api-client";

import { CompareView } from "./compare-view";
import { HistoryGraph } from "./history-graph";
import { APPLICATION_LABELS, type CanvasAsset, formatValue, type History, type Job } from "./types";

const JOB_LABELS: Record<string, string> = {
  captureCheckpoint: "Capture",
  openCheckpoint: "Switch branch",
};

function jobSummary(job: Job): string {
  const label = JOB_LABELS[job.operation] ?? job.operation;
  const branch = typeof job.params.branchName === "string" ? ` to ${job.params.branchName}` : "";
  if (job.status === "failed")
    return `${label}${branch} failed: ${job.error?.message ?? job.error?.code ?? "unknown error"}`;
  if (job.status === "queued") return `${label}${branch} waiting for the connector…`;
  if (job.status === "leased") return `${label}${branch} running (attempt ${job.attempts})…`;
  return `${label}${branch} ${job.status}`;
}

export function Inspector({
  projectId,
  asset,
  onClose,
  onChanged,
}: {
  projectId: string;
  asset: CanvasAsset;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const historyUrl = `/api/projects/${projectId}/assets/${asset.id}/history`;
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    let cancelled = false;
    api<History>("GET", historyUrl)
      .then((data) => !cancelled && setHistory(data))
      .catch((e) => !cancelled && setNotice(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [historyUrl, reloadKey]);

  // Poll while jobs are pending so captures and branch switches appear without a reload.
  const pending =
    history?.jobs.some((j) => j.status === "queued" || j.status === "leased") ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      setReloadKey((k) => k + 1);
      onChangedRef.current();
    }, 3000);
    return () => clearInterval(timer);
  }, [pending]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      setReloadKey((k) => k + 1);
      onChanged();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : String(e));
    }
  };

  if (!history) {
    return (
      <aside className="w-96 shrink-0 border-l border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
        Loading history…
      </aside>
    );
  }

  const canEdit = history.role !== "reviewer";
  const operations = asset.connector.capabilities?.operations ?? [];
  const canCapture = canEdit && asset.connector.online && operations.includes("captureCheckpoint");
  const canSwitch = canEdit && operations.includes("openCheckpoint");
  const checkpoint = history.checkpoints.find((c) => c.id === selected) ?? null;
  const compared = compare
    .map((id) => history.checkpoints.find((c) => c.id === id))
    .filter((c) => !!c);
  const lastFailedCheckout = history.jobs.find((j) => j.operation === "openCheckpoint");

  return (
    <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{history.asset.name}</h2>
          <p className="truncate text-xs text-zinc-500" title={history.asset.path ?? ""}>
            {APPLICATION_LABELS[history.asset.application] ?? history.asset.application} ·{" "}
            {history.asset.path ?? "no document linked"}
          </p>
        </div>
        <button
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={onClose}
          aria-label="Close inspector"
        >
          ✕
        </button>
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Capture</h3>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="Message (optional)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={!canCapture}
          />
          <button
            className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={!canCapture}
            title={
              canCapture
                ? "Capture the open document onto the active branch"
                : "Open the document in its application with the Sonder panel connected"
            }
            onClick={() =>
              void run(async () => {
                await api(
                  "POST",
                  `/api/projects/${projectId}/assets/${asset.id}/capture`,
                  message ? { message } : {},
                );
                setMessage("");
              }, "Capture queued")
            }
          >
            Capture
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Branches</h3>
        <ul className="flex flex-col gap-1">
          {history.branches.map((b) => {
            const active = b.id === history.asset.activeBranchId;
            return (
              <li key={b.id} className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">
                  {b.name}
                  {active && <span className="ml-1 text-green-600">● active</span>}
                </span>
                {!active && (
                  <button
                    className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700"
                    disabled={!canSwitch}
                    onClick={() =>
                      void run(
                        () =>
                          api("POST", `/api/projects/${projectId}/assets/${asset.id}/checkout`, {
                            branchId: b.id,
                          }),
                        `Switching to ${b.name}…`,
                      )
                    }
                  >
                    Switch
                  </button>
                )}
              </li>
            );
          })}
          {!history.branches.length && (
            <li className="text-xs text-zinc-500">The first capture creates the main branch.</li>
          )}
        </ul>
      </section>

      {history.jobs.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Recent activity
          </h3>
          {history.jobs.slice(0, 4).map((job) => (
            <p
              key={job.id}
              className={`text-xs ${job.status === "failed" ? "text-red-600" : "text-zinc-600 dark:text-zinc-400"}`}
            >
              {jobSummary(job)}
            </p>
          ))}
          {lastFailedCheckout?.status === "failed" &&
            lastFailedCheckout.error?.code === "UNCAPTURED_CHANGES" &&
            canSwitch && (
              <button
                className="self-start rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 dark:border-red-800 dark:text-red-300"
                onClick={() =>
                  void run(
                    () =>
                      api("POST", `/api/projects/${projectId}/assets/${asset.id}/checkout`, {
                        branchId: lastFailedCheckout.params.branchId,
                        force: true,
                      }),
                    "Switching without capturing…",
                  )
                }
              >
                Switch anyway (uncaptured changes stay in the old file)
              </button>
            )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">History</h3>
          <button
            className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700"
            disabled={compared.length !== 2}
            onClick={() => setShowCompare(true)}
          >
            Compare {compared.length}/2
          </button>
        </div>
        {history.checkpoints.length ? (
          <HistoryGraph
            checkpoints={history.checkpoints}
            branches={history.branches}
            activeBranchId={history.asset.activeBranchId}
            selected={selected}
            compare={compare}
            onSelect={setSelected}
            onToggleCompare={(id) =>
              setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id]))
            }
          />
        ) : (
          <p className="text-xs text-zinc-500">No checkpoints yet.</p>
        )}
      </section>

      {checkpoint && (
        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Checkpoint
          </h3>
          {checkpoint.previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img
              src={checkpoint.previewUrl}
              alt=""
              className="w-full rounded border border-zinc-200 dark:border-zinc-700"
            />
          )}
          <p className="text-xs text-zinc-500">
            {checkpoint.document
              ? `${checkpoint.document.width}×${checkpoint.document.height} · ${checkpoint.document.colorMode} · `
              : ""}
            {(checkpoint.nativeBytes / 1024).toFixed(0)} KB · id {checkpoint.id.slice(0, 8)}
          </p>
          <table className="w-full text-left text-[11px]">
            <tbody>
              {checkpoint.elements.flatMap((e) =>
                e.properties.map((p) => (
                  <tr key={`${e.name}-${p.type}`}>
                    <td className="pr-2 text-zinc-500">{e.name}</td>
                    <td className="pr-2 font-mono">{p.type}</td>
                    <td className="font-mono">{formatValue(p.value)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          {canEdit && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("POST", `/api/projects/${projectId}/assets/${asset.id}/branches`, {
                    name: branchName,
                    checkpointId: checkpoint.id,
                  });
                  setBranchName("");
                }, `Branch "${branchName}" created from this checkpoint`);
              }}
            >
              <input
                className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                placeholder="New branch name"
                required
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
              />
              <button className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
                Branch from here
              </button>
            </form>
          )}
        </section>
      )}

      {notice && <p className="text-xs text-zinc-600 dark:text-zinc-400">{notice}</p>}
      {showCompare && compared.length === 2 && (
        <CompareView
          left={compared[0]!}
          right={compared[1]!}
          onClose={() => setShowCompare(false)}
        />
      )}
    </aside>
  );
}
