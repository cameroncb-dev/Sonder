"use client";

import { useEffect, useState } from "react";

import { api, ApiClientError } from "@/lib/api-client";

import {
  type Branch,
  type Combination,
  type CombineRow,
  formatValue,
  type HistoryCheckpoint,
  type Proposal,
  PROPOSAL_STATUS,
  type Side,
} from "./types";

const STATUS_LABEL: Record<CombineRow["status"], string> = {
  unchanged: "Unchanged",
  target: "Changed on target",
  source: "Changed on source",
  both_same: "Same change on both",
  conflict: "Conflict",
};

const show = (value: unknown) => (value === undefined ? "—" : formatValue(value));

/**
 * Combine two branches of one asset: review every property against the shared ancestor,
 * choose what to take, build a candidate, check its preview, then approve or discard it.
 * Opening with `proposal` resumes reviewing that proposal.
 */
export function CombineView({
  projectId,
  assetId,
  branches,
  checkpoints,
  activeBranchId,
  canEdit,
  canSwitch,
  proposal: initial,
  onClose,
  onChanged,
}: {
  projectId: string;
  assetId: string;
  branches: Branch[];
  checkpoints: HistoryCheckpoint[];
  activeBranchId: string | null;
  canEdit: boolean;
  canSwitch: boolean;
  proposal?: Proposal;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [targetId, setTargetId] = useState(
    initial?.request.targetBranchId ?? activeBranchId ?? branches[0]?.id ?? "",
  );
  const [sourceId, setSourceId] = useState(
    initial?.request.sourceBranchId ?? branches.find((b) => b.id !== targetId)?.id ?? "",
  );
  const [baseId, setBaseId] = useState<string | undefined>(undefined);
  const [combination, setCombination] = useState<Combination | null>(null);
  const [baseCandidates, setBaseCandidates] = useState<string[] | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Side>>({});
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [proposalId, setProposalId] = useState<string | null>(initial?.id ?? null);
  const [proposal, setProposal] = useState<Proposal | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/projects/${projectId}`;

  // Load the property comparison whenever the branch pair or baseline changes.
  useEffect(() => {
    if (proposalId || !targetId || !sourceId || targetId === sourceId) return;
    let cancelled = false;
    const query = new URLSearchParams({ targetBranchId: targetId, sourceBranchId: sourceId });
    if (baseId) query.set("baseCheckpointId", baseId);
    api<Combination>("GET", `${base}/assets/${assetId}/combine?${query}`)
      .then((c) => {
        if (cancelled) return;
        setCombination(c);
        setBaseCandidates(null);
        setResolutions({});
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setCombination(null);
        if (e instanceof ApiClientError && e.code === "BASELINE_REQUIRED") {
          setBaseCandidates((e.details as { candidates?: string[] })?.candidates ?? []);
        }
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [base, assetId, targetId, sourceId, baseId, proposalId]);

  // Follow the proposal while its candidate is being built.
  useEffect(() => {
    if (!proposalId) return;
    let cancelled = false;
    const load = () =>
      api<{ proposals: Proposal[] }>("GET", `${base}/assets/${assetId}/proposals`)
        .then(({ proposals }) => {
          const p = proposals.find((x) => x.id === proposalId);
          if (!cancelled && p) setProposal(p);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [base, assetId, proposalId]);

  const sideOf = (row: CombineRow): Side | undefined =>
    resolutions[row.id] ?? row.defaultSide ?? undefined;
  const rows = combination?.rows ?? [];
  const visible = rows.filter((r) => showUnchanged || r.status !== "unchanged");
  const unresolved = rows.filter((r) => !sideOf(r));
  const changes = rows.filter(
    (r) => sideOf(r) === "source" && r.supported && show(r.source) !== show(r.target),
  );
  const checkpointLabel = (id: string) => {
    const c = checkpoints.find((x) => x.id === id);
    return c
      ? `${c.message ?? id.slice(0, 8)} · ${new Date(c.createdAt).toLocaleString()}`
      : id.slice(0, 8);
  };

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const createCandidate = () =>
    act(async () => {
      const { proposal: created } = await api<{ proposal: { id: string } }>(
        "POST",
        `${base}/assets/${assetId}/proposals`,
        {
          targetBranchId: targetId,
          sourceBranchId: sourceId,
          ...(baseId ? { baseCheckpointId: baseId } : {}),
          resolutions,
        },
      );
      setProposalId(created.id);
    });

  const approve = () =>
    act(async () => {
      await api("POST", `${base}/proposals/${proposal!.id}/approve`, {
        candidateCheckpointId: proposal!.candidate!.id,
      });
      setProposal({ ...proposal!, status: "finalized" });
    });

  const discard = () =>
    act(async () => {
      await api("POST", `${base}/proposals/${proposal!.id}/reject`);
      setProposal({ ...proposal!, status: "rejected" });
    });

  const openResult = () =>
    act(async () => {
      await api("POST", `${base}/assets/${assetId}/checkout`, {
        branchId: proposal!.request.targetBranchId,
      });
      onClose();
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-6xl flex-col gap-4 overflow-auto rounded-lg bg-white p-4 text-sm dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Combine branches</h2>
          <button
            className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {proposal ? (
          <ProposalReview
            proposal={proposal}
            checkpoints={checkpoints}
            canEdit={canEdit}
            canSwitch={canSwitch}
            busy={busy}
            onApprove={() => void approve()}
            onDiscard={() => void discard()}
            onOpen={() => void openResult()}
            onStartOver={() => {
              setProposalId(null);
              setProposal(null);
            }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Into (target, gets the result)
                <select
                  className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  value={targetId}
                  onChange={(e) => {
                    setTargetId(e.target.value);
                    setBaseId(undefined);
                  }}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="pb-1.5 text-zinc-400">←</span>
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                Take changes from (source)
                <select
                  className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  value={sourceId}
                  onChange={(e) => {
                    setSourceId(e.target.value);
                    setBaseId(undefined);
                  }}
                >
                  {branches
                    .filter((b) => b.id !== targetId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </label>
              {(baseCandidates || combination?.base.chosen) && (
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  Baseline (compare both against)
                  <select
                    className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    value={baseId ?? ""}
                    onChange={(e) => setBaseId(e.target.value || undefined)}
                  >
                    <option value="">Choose a checkpoint…</option>
                    {checkpoints.map((c) => (
                      <option key={c.id} value={c.id}>
                        {baseCandidates?.includes(c.id) ? "★ " : ""}
                        {checkpointLabel(c.id)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {combination && (
              <>
                <p className="text-xs text-zinc-500">
                  Comparing both branches against{" "}
                  <span className="font-medium">{checkpointLabel(combination.base.id)}</span>
                  {combination.base.chosen ? " (chosen baseline)" : " (their shared ancestor)"}. The
                  result starts from{" "}
                  <span className="font-medium">{combination.target.branchName}</span>; anything you
                  don&apos;t take stays exactly as it is there.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="py-1 pr-2">Layer</th>
                        <th className="py-1 pr-2">Property</th>
                        <th className="py-1 pr-2">Baseline</th>
                        <th className="py-1 pr-2">{combination.target.branchName}</th>
                        <th className="py-1 pr-2">{combination.source.branchName}</th>
                        <th className="py-1">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row) => {
                        const side = sideOf(row);
                        const choose = (s: Side) => setResolutions((r) => ({ ...r, [row.id]: s }));
                        return (
                          <tr
                            key={row.id}
                            className={`border-t border-zinc-200 dark:border-zinc-800 ${
                              row.status === "conflict" && !side
                                ? "bg-red-50 dark:bg-red-950"
                                : row.status !== "unchanged"
                                  ? "bg-amber-50/60 dark:bg-amber-950/40"
                                  : ""
                            }`}
                          >
                            <td className="py-1 pr-2">{row.name}</td>
                            <td className="py-1 pr-2 font-mono">{row.property}</td>
                            <td className="py-1 pr-2 font-mono">{show(row.base)}</td>
                            <td
                              className={`py-1 pr-2 font-mono ${side === "target" ? "font-semibold" : ""}`}
                            >
                              {show(row.target)}
                            </td>
                            <td
                              className={`py-1 pr-2 font-mono ${side === "source" ? "font-semibold" : ""}`}
                            >
                              {show(row.source)}
                            </td>
                            <td className="py-1">
                              {row.status === "unchanged" ? (
                                <span className="text-zinc-400">{STATUS_LABEL[row.status]}</span>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-zinc-500">{STATUS_LABEL[row.status]}:</span>
                                  {(["target", "source"] as const).map((s) => (
                                    <label key={s} className="flex items-center gap-1">
                                      <input
                                        type="radio"
                                        name={row.id}
                                        checked={side === s}
                                        disabled={!canEdit || (s === "source" && !row.supported)}
                                        onChange={() => choose(s)}
                                      />
                                      {s === "target"
                                        ? `keep ${combination.target.branchName}`
                                        : `take ${combination.source.branchName}`}
                                    </label>
                                  ))}
                                  {!row.supported && (
                                    <span className="text-zinc-400" title={row.reason}>
                                      (can&apos;t combine: {row.reason})
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!visible.length && (
                    <p className="py-2 text-xs text-zinc-500">
                      No supported property differs between these branches.
                    </p>
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-500">
                  <input
                    type="checkbox"
                    checked={showUnchanged}
                    onChange={(e) => setShowUnchanged(e.target.checked)}
                  />
                  Show unchanged properties
                </label>
                {combination.structural.length > 0 && (
                  <p className="text-xs text-zinc-500">
                    Not combined (layers added or removed aren&apos;t merged; the result keeps{" "}
                    {combination.target.branchName}&apos;s layers):{" "}
                    {combination.structural
                      .map((s) => `${s.name} (${s.change.replaceAll("_", " ")})`)
                      .join(", ")}
                  </p>
                )}
                {canEdit && (
                  <div className="flex items-center gap-3">
                    <button
                      className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-40 dark:bg-white dark:text-black"
                      disabled={busy || unresolved.length > 0 || changes.length === 0}
                      onClick={() => void createCandidate()}
                    >
                      Create candidate ({changes.length}{" "}
                      {changes.length === 1 ? "change" : "changes"})
                    </button>
                    {unresolved.length > 0 && (
                      <span className="text-xs text-red-600">
                        Resolve {unresolved.length}{" "}
                        {unresolved.length === 1 ? "conflict" : "conflicts"} first.
                      </span>
                    )}
                    <span className="text-xs text-zinc-500">
                      Builds a separate copy in the app; your open document isn&apos;t changed.
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

function ProposalReview({
  proposal,
  checkpoints,
  canEdit,
  canSwitch,
  busy,
  onApprove,
  onDiscard,
  onOpen,
  onStartOver,
}: {
  proposal: Proposal;
  checkpoints: HistoryCheckpoint[];
  canEdit: boolean;
  canSwitch: boolean;
  busy: boolean;
  onApprove: () => void;
  onDiscard: () => void;
  onOpen: () => void;
  onStartOver: () => void;
}) {
  const { request, candidate, status } = proposal;
  const target = checkpoints.find((c) => c.id === request.targetCheckpointId);
  const source = checkpoints.find((c) => c.id === request.sourceCheckpointId);
  const error = proposal.item.outcome?.error;
  const panels = [
    { label: `${request.targetBranchName} (target)`, url: target?.previewUrl },
    { label: "Candidate", url: candidate?.previewUrl, highlight: true },
    { label: `${request.sourceBranchName} (source)`, url: source?.previewUrl },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p>
        Combine <span className="font-medium">{request.sourceBranchName}</span> into{" "}
        <span className="font-medium">{request.targetBranchName}</span> ·{" "}
        <span className="font-medium">{PROPOSAL_STATUS[status]}</span>
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {panels.map((p) => (
          <figure key={p.label} className="flex flex-col gap-1">
            {p.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img
                src={p.url}
                alt={p.label}
                className={`w-full rounded border ${
                  p.highlight
                    ? "border-blue-500 ring-2 ring-blue-500/30"
                    : "border-zinc-200 dark:border-zinc-700"
                }`}
              />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-800">
                {status === "preparing" ? "Building in the app…" : "No preview"}
              </div>
            )}
            <figcaption className="text-xs text-zinc-500">{p.label}</figcaption>
          </figure>
        ))}
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Changes applied to {request.targetBranchName}
        </h3>
        <ul className="text-xs">
          {request.changeSet.changes.map((c) => (
            <li key={`${c.elementId}-${c.property.type}`} className="font-mono">
              {c.property.type} → {formatValue(c.property.value)}
            </li>
          ))}
        </ul>
      </div>

      {status === "failed" && (
        <p className="text-xs text-red-600">
          Building the candidate failed:{" "}
          {error?.issues?.[0]?.message ?? error?.message ?? error?.code ?? "unknown error"}
        </p>
      )}
      {status === "ready" && (
        <p className="text-xs text-zinc-500">
          Approving finalizes exactly this candidate as the new head of {request.targetBranchName}.
          Both source versions stay in history unchanged.
        </p>
      )}
      {status === "finalized" && (
        <p className="text-xs text-green-700 dark:text-green-400">
          Approved and added to {request.targetBranchName}&apos;s history.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status === "ready" && canEdit && (
          <>
            <button
              className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-40 dark:bg-white dark:text-black"
              disabled={busy || !candidate}
              onClick={onApprove}
            >
              Approve and finalize
            </button>
            <button
              className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
              disabled={busy}
              onClick={onDiscard}
            >
              Discard
            </button>
          </>
        )}
        {status === "finalized" && canSwitch && (
          <button
            className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            disabled={busy}
            onClick={onOpen}
            title="Opens the result as a working copy; refuses if your open document has unsaved or uncaptured changes"
          >
            Open result in the app
          </button>
        )}
        {["failed", "rejected", "finalized"].includes(status) && canEdit && (
          <button
            className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            onClick={onStartOver}
          >
            New combination
          </button>
        )}
      </div>
    </div>
  );
}
