"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";

import { handles } from "./handles";
import {
  type CanvasTheme,
  type ColorRole,
  COLOR_ROLES,
  formatValue,
  PROPOSAL_STATUS,
  type ThemeDetail,
  type ThemePlan,
  type ThemeUpdate,
} from "./types";

export type ThemeNode = Node<{ theme: CanvasTheme }, "theme">;

const ROLE_LABEL: Record<ColorRole, string> = {
  primary: "Primary",
  background: "Background",
  text: "Text",
  accent: "Accent",
};

/** A theme on the canvas: its name and four colors. Click to open its panel. */
export function ThemeCard({ data, selected }: NodeProps<ThemeNode>) {
  const { theme } = data;
  return (
    <div
      className={`w-56 rounded-lg border bg-white p-3 shadow-sm dark:bg-zinc-900 ${selected ? "border-blue-500 ring-2 ring-blue-500/30" : "border-zinc-200 dark:border-zinc-700"}`}
    >
      {handles}
      <div className="mb-2 flex items-center justify-between">
        <span className="truncate text-sm font-medium">{theme.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Theme</span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {COLOR_ROLES.map((role) => (
          <div key={role} className="flex flex-col items-center gap-0.5">
            <span
              className="h-9 w-full rounded border border-black/10"
              style={{ backgroundColor: theme.colors[role] }}
            />
            <span className="text-[9px] text-zinc-500">{ROLE_LABEL[role]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PLAN_LABEL: Record<ThemePlan["status"], string> = {
  ready: "Ready",
  no_changes: "Already matches",
  no_mappings: "No layers mapped",
  unsupported: "Can't apply",
};

const ITEM_LABEL: Record<ThemeUpdate["items"][number]["status"], string> = {
  pending: "Waiting…",
  running: "Building in the app…",
  ready: "Ready for review",
  approved: "Approved",
  finalized: "Applied",
  failed: "Failed",
  excluded: "Excluded",
};

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{children}</p>;
}

const heading = "text-xs font-semibold uppercase tracking-wide text-zinc-500";
const smallButton =
  "rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700";
const primaryButton =
  "rounded bg-zinc-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-black";

/**
 * Everything about one theme: its colors, which layer of each document takes which color,
 * whether each document can take the theme, and applying, reviewing and approving the result.
 */
export function ThemePanel({
  projectId,
  themeId,
  onClose,
  onChanged,
  onDelete,
}: {
  projectId: string;
  themeId: string;
  onClose: () => void;
  /** Theme colors or name changed, or documents were updated. */
  onChanged: () => void;
  onDelete: () => void;
}) {
  const base = `/api/projects/${projectId}/themes/${themeId}`;
  const [detail, setDetail] = useState<ThemeDetail | null>(null);
  const [updates, setUpdates] = useState<ThemeUpdate[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [mapping, setMapping] = useState<string | null>(null);
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [approve, setApprove] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<ThemeDetail>("GET", base),
      api<{ proposals: ThemeUpdate[] }>("GET", `${base}/proposals`),
    ])
      .then(([d, u]) => {
        if (cancelled) return;
        setDetail(d);
        setUpdates(u.proposals);
      })
      .catch((e) => !cancelled && setNotice(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [base, reloadKey]);

  // Follow candidates while they are being built.
  const latest = updates[0];
  const building = latest?.status === "preparing";
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => setReloadKey((k) => k + 1), 3000);
    return () => clearInterval(timer);
  }, [building]);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      reload();
      onChanged();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!detail)
    return (
      <aside className="w-[26rem] shrink-0 border-l border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
        {notice ?? "Loading theme…"}
      </aside>
    );

  const canEdit = detail.role !== "reviewer";
  const { theme } = detail;
  const plan = (assetId: string) => detail.plans.find((p) => p.assetId === assetId);
  const included = (p: ThemePlan) => include[p.assetId] ?? p.status === "ready";
  const chosen = detail.plans.filter((p) => p.status === "ready" && included(p));
  const reviewable = latest?.items.filter((i) => i.status === "ready") ?? [];
  const toApprove = reviewable.filter((i) => approve[i.id] ?? true);

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col gap-4 overflow-y-auto border-l border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <input
            className="w-full truncate bg-transparent font-semibold outline-none"
            defaultValue={theme.name}
            readOnly={!canEdit}
            aria-label="Theme name"
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== theme.name &&
              void act(() => api("PATCH", base, { name: e.target.value.trim() }))
            }
          />
          <p className="text-xs text-zinc-500">Theme</p>
        </div>
        <button
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={onClose}
          aria-label="Close theme"
        >
          ✕
        </button>
      </header>

      <section className="flex flex-col gap-2">
        <h3 className={heading}>Colors</h3>
        <Hint>Four named colors. Map them to layers below, then apply the theme to documents.</Hint>
        <div className="grid grid-cols-4 gap-2">
          {COLOR_ROLES.map((role) => (
            <label
              key={role}
              className="flex flex-col items-center gap-1 text-[11px] text-zinc-500"
            >
              <input
                type="color"
                className="h-10 w-full cursor-pointer rounded border border-zinc-300 bg-transparent dark:border-zinc-700"
                defaultValue={theme.colors[role]}
                disabled={!canEdit}
                onBlur={(e) => {
                  const value = e.target.value.toUpperCase();
                  if (value !== theme.colors[role])
                    void act(() =>
                      api("PATCH", base, { colors: { ...theme.colors, [role]: value } }),
                    );
                }}
              />
              {ROLE_LABEL[role]}
              <span className="font-mono text-[10px]">{theme.colors[role]}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={heading}>Documents</h3>
        <Hint>
          Choose which layer takes each theme color, per document. Only text and solid-color fill
          layers can be themed. Documents are checked one by one before anything runs.
        </Hint>
        {detail.assets.length === 0 && <Hint>No documents in this project yet.</Hint>}
        {detail.assets.map((asset) => {
          const p = plan(asset.id);
          return (
            <div key={asset.id} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <label className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canEdit || p?.status !== "ready"}
                    checked={!!p && p.status === "ready" && included(p)}
                    onChange={(e) => setInclude((s) => ({ ...s, [asset.id]: e.target.checked }))}
                    aria-label={`Include ${asset.name}`}
                  />
                  <span className="truncate font-medium">{asset.name}</span>
                </label>
                <span
                  className={`shrink-0 text-xs ${p?.status === "ready" ? "text-green-700 dark:text-green-400" : p?.status === "unsupported" ? "text-red-600" : "text-zinc-500"}`}
                >
                  {p ? PLAN_LABEL[p.status] : ""}
                </span>
              </div>
              {p && p.reasons.length > 0 && p.status !== "no_mappings" && (
                <p className="mt-1 text-[11px] text-zinc-500">{p.reasons.join(" · ")}</p>
              )}
              {p?.status === "ready" && (
                <ul className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                  {p.changes.map((c) => (
                    <li key={`${c.element}-${c.property}`} className="flex items-center gap-1">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10"
                        style={{ backgroundColor: c.to }}
                      />
                      {c.element}: {c.from ?? "—"} → {c.to} ({ROLE_LABEL[c.role]})
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <button
                  className="mt-1 text-xs text-blue-700 hover:underline dark:text-blue-400"
                  onClick={() => setMapping(mapping === asset.id ? null : asset.id)}
                >
                  {mapping === asset.id ? "Close mapping" : "Map layers…"}
                </button>
              )}
              {mapping === asset.id && (
                <MappingEditor
                  asset={asset}
                  busy={busy}
                  onSave={(elements) =>
                    void act(async () => {
                      await api("PUT", `${base}/mappings/${asset.id}`, { elements });
                      setMapping(null);
                    }, `Mapping saved for ${asset.name}`)
                  }
                />
              )}
            </div>
          );
        })}
        {canEdit && (
          <button
            className={primaryButton}
            disabled={busy || chosen.length === 0 || building}
            onClick={() =>
              void act(
                () => api("POST", `${base}/apply`, { assetIds: chosen.map((p) => p.assetId) }),
                "Building a candidate for each document…",
              )
            }
          >
            Apply to {chosen.length} {chosen.length === 1 ? "document" : "documents"}
          </button>
        )}
      </section>

      {latest && (
        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h3 className={heading}>Latest update</h3>
            <span className="text-xs text-zinc-500">{PROPOSAL_STATUS[latest.status]}</span>
          </div>
          {latest.status === "partially_failed" && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Some documents failed. The others are unaffected; retry the failed ones on their own.
            </p>
          )}
          {latest.items.map((item) => (
            <div key={item.id} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <label className="flex min-w-0 items-center gap-2">
                  {item.status === "ready" && canEdit && (
                    <input
                      type="checkbox"
                      checked={approve[item.id] ?? true}
                      onChange={(e) => setApprove((s) => ({ ...s, [item.id]: e.target.checked }))}
                      aria-label={`Approve ${item.assetName}`}
                    />
                  )}
                  <span className="truncate font-medium">{item.assetName}</span>
                </label>
                <span
                  className={`shrink-0 text-xs ${item.status === "failed" ? "text-red-600" : item.status === "finalized" ? "text-green-700 dark:text-green-400" : "text-zinc-500"}`}
                >
                  {ITEM_LABEL[item.status]}
                </span>
              </div>
              {(item.candidatePreviewUrl || item.beforePreviewUrl) &&
                item.status !== "excluded" && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      { label: "Before", url: item.beforePreviewUrl },
                      { label: "With theme", url: item.candidatePreviewUrl },
                    ].map((p) => (
                      <figure key={p.label} className="flex flex-col gap-0.5">
                        {p.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                          <img
                            src={p.url}
                            alt={`${item.assetName} ${p.label}`}
                            className="w-full rounded border border-zinc-200 dark:border-zinc-700"
                          />
                        ) : (
                          <div className="flex aspect-[4/3] items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-800">
                            {item.status === "running" ? "Building…" : "—"}
                          </div>
                        )}
                        <figcaption className="text-[10px] text-zinc-500">{p.label}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              {item.status === "failed" && (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-red-600">
                    {item.outcome?.error?.issues?.[0]?.message ??
                      item.outcome?.error?.message ??
                      "Failed"}
                  </p>
                  {canEdit && latest.status !== "rejected" && (
                    <button
                      className={smallButton}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () =>
                            api(
                              "POST",
                              `/api/projects/${projectId}/proposals/${latest.id}/items/${item.id}/retry`,
                            ),
                          `Retrying ${item.assetName}…`,
                        )
                      }
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
              {item.status === "excluded" && item.outcome?.reason && (
                <p className="mt-1 text-[11px] text-zinc-500">{item.outcome.reason}</p>
              )}
            </div>
          ))}
          {canEdit && reviewable.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={primaryButton}
                disabled={busy || toApprove.length === 0}
                onClick={() =>
                  void act(
                    () =>
                      api(
                        "POST",
                        `/api/projects/${projectId}/proposals/${latest.id}/approve-items`,
                        {
                          items: toApprove.map((i) => ({
                            itemId: i.id,
                            candidateCheckpointId: i.candidateCheckpointId,
                          })),
                        },
                      ),
                    "Approved. Each document's branch now has the themed version.",
                  )
                }
              >
                Approve {toApprove.length} of {reviewable.length}
              </button>
              <button
                className={smallButton}
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api("POST", `/api/projects/${projectId}/proposals/${latest.id}/reject`),
                    "Discarded.",
                  )
                }
              >
                Discard
              </button>
              <Hint>
                Unticked documents are left out. Approving adds each result to its document&apos;s
                history.
              </Hint>
            </div>
          )}
        </section>
      )}

      {notice && <p className="text-xs text-zinc-600 dark:text-zinc-400">{notice}</p>}
      {canEdit && (
        <section className="mt-auto border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <button className="text-xs text-zinc-500 hover:text-red-600" onClick={onDelete}>
            Delete theme
          </button>
        </section>
      )}
    </aside>
  );
}

function MappingEditor({
  asset,
  busy,
  onSave,
}: {
  asset: ThemeDetail["assets"][number];
  busy: boolean;
  onSave: (elements: Array<{ native: unknown; colorRole: ColorRole | null }>) => void;
}) {
  const [choices, setChoices] = useState<Record<string, ColorRole | null>>(
    Object.fromEntries(asset.elements.map((e) => [e.key, e.colorRole])),
  );
  if (!asset.elements.length)
    return (
      <Hint>
        No text or fill layers in this document&apos;s latest version. Capture it after adding some.
      </Hint>
    );
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {asset.elements.map((e) => (
        <label key={e.key} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/10"
              style={{ backgroundColor: typeof e.color === "string" ? e.color : undefined }}
            />
            <span className="truncate">{e.name}</span>
            <span className="text-zinc-400">{e.kind === "text" ? "text" : "fill"}</span>
            {!e.editable && <span className="text-red-600">(not editable)</span>}
          </span>
          <select
            className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
            value={choices[e.key] ?? ""}
            onChange={(ev) =>
              setChoices((c) => ({ ...c, [e.key]: (ev.target.value || null) as ColorRole | null }))
            }
            title={typeof e.color === "string" ? `Now ${formatValue(e.color)}` : undefined}
          >
            <option value="">Not themed</option>
            {COLOR_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button
        className={smallButton}
        disabled={busy}
        onClick={() =>
          onSave(
            asset.elements.map((e) => ({ native: e.native, colorRole: choices[e.key] ?? null })),
          )
        }
      >
        Save mapping
      </button>
    </div>
  );
}
