"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";

import { formatValue } from "./types";

interface Change {
  elementKey: string;
  element: string;
  property: string;
  from?: unknown;
  to: unknown;
}

interface Idea {
  title: string;
  rationale: string;
  changes: Change[];
  skipped: string[];
}

interface Tried {
  id: string;
  status: string;
  title: string;
  rationale: string;
  changes: Change[];
  candidateCheckpointId: string | null;
  candidatePreviewUrl: string | null;
  beforePreviewUrl: string | null;
  error: string | null;
}

const heading = "text-xs font-semibold uppercase tracking-wide text-zinc-500";
const smallButton =
  "rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700";
const primaryButton =
  "rounded bg-zinc-900 px-2.5 py-1 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-black";

function Swatch({ value }: { value: unknown }) {
  return typeof value === "string" && /^#[0-9A-F]{6}$/i.test(value) ? (
    <span
      className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10 align-middle"
      style={{ backgroundColor: value }}
    />
  ) : null;
}

function ChangeList({ changes }: { changes: Change[] }) {
  return (
    <ul className="text-[11px] text-zinc-600 dark:text-zinc-400">
      {changes.map((c) => (
        <li key={`${c.elementKey}-${c.property}`}>
          {c.element}: {c.property.replace(/^(text|fill)\./, "")} <Swatch value={c.from} />{" "}
          {c.from === undefined ? "" : formatValue(c.from)} → <Swatch value={c.to} />{" "}
          {formatValue(c.to)}
        </li>
      ))}
    </ul>
  );
}

/**
 * AI-suggested directions for one document: ask, try one as a candidate built in the app,
 * then keep it as a new branch or discard it. Nothing changes without a click.
 */
export function Ideas({
  projectId,
  assetId,
  canEdit,
  onChanged,
}: {
  projectId: string;
  assetId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const base = `/api/projects/${projectId}/assets/${assetId}/suggestions`;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [hint, setHint] = useState("");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [tried, setTried] = useState<Tried[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api<{ enabled: boolean }>("GET", "/api/ai/status")
      .then((s) => !cancelled && setEnabled(s.enabled))
      .catch(() => !cancelled && setEnabled(false));
    void api<{ suggestions: Tried[] }>("GET", base)
      .then((r) => !cancelled && setTried(r.suggestions))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base, reloadKey]);

  const building = tried.some((t) => t.status === "preparing");
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
      setReloadKey((k) => k + 1);
      onChanged();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (enabled === false && !tried.length)
    return (
      <section className="flex flex-col gap-1">
        <h3 className={heading}>Ideas</h3>
        <p className="text-[11px] text-zinc-500">
          AI suggestions are off. Add a Gemini key on the server to turn them on.
        </p>
      </section>
    );

  return (
    <section className="flex flex-col gap-2">
      <h3 className={heading}>Ideas</h3>
      <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
        Gemini looks at this version and suggests directions as concrete text and color changes. Try
        one to see it built in the app, then keep it as a new branch.
      </p>
      {canEdit && enabled && (
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="Optional: e.g. warmer, for a jazz night"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
          <button
            className={primaryButton}
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const r = await api<{ suggestions: Idea[] }>("POST", base, hint ? { hint } : {});
                setIdeas(r.suggestions);
              })
            }
          >
            {busy && !ideas.length ? "Thinking…" : "Suggest"}
          </button>
        </div>
      )}

      {ideas.map((idea) => (
        <div key={idea.title} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium">{idea.title}</div>
              <p className="text-[11px] text-zinc-500">{idea.rationale}</p>
            </div>
            {canEdit && (
              <button
                className={smallButton}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api("POST", `${base}/try`, {
                      title: idea.title,
                      rationale: idea.rationale,
                      changes: idea.changes,
                    });
                    setIdeas((list) => list.filter((i) => i !== idea));
                  }, `Building "${idea.title}" in the app…`)
                }
              >
                Try it
              </button>
            )}
          </div>
          <ChangeList changes={idea.changes} />
          {idea.skipped.length > 0 && (
            <p className="text-[10px] text-zinc-400">Left out: {idea.skipped.join("; ")}</p>
          )}
        </div>
      ))}

      {tried.map((t) => (
        <div key={t.id} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium">{t.title}</span>
            <span
              className={`shrink-0 text-[11px] ${t.status === "failed" ? "text-red-600" : t.status === "finalized" ? "text-green-700 dark:text-green-400" : "text-zinc-500"}`}
            >
              {t.status === "preparing"
                ? "Building in the app…"
                : t.status === "ready"
                  ? "Ready to review"
                  : t.status === "finalized"
                    ? "Kept as a branch"
                    : t.status === "rejected"
                      ? "Discarded"
                      : "Failed"}
            </span>
          </div>
          {t.status !== "rejected" && (t.beforePreviewUrl || t.candidatePreviewUrl) && (
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {[
                { label: "Now", url: t.beforePreviewUrl },
                { label: "Suggestion", url: t.candidatePreviewUrl },
              ].map((p) => (
                <figure key={p.label}>
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    <img
                      src={p.url}
                      alt={`${t.title} ${p.label}`}
                      className="w-full rounded border border-zinc-200 dark:border-zinc-700"
                    />
                  ) : (
                    <div className="aspect-[4/3] rounded bg-zinc-100 dark:bg-zinc-800" />
                  )}
                  <figcaption className="text-[10px] text-zinc-500">{p.label}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {t.error && <p className="text-[11px] text-red-600">{t.error}</p>}
          {t.status === "ready" && canEdit && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <input
                className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                aria-label="Branch name"
                value={names[t.id] ?? t.title}
                onChange={(e) => setNames((n) => ({ ...n, [t.id]: e.target.value }))}
              />
              <button
                className={primaryButton}
                disabled={busy || !(names[t.id] ?? t.title).trim()}
                onClick={() =>
                  void act(
                    () =>
                      api("POST", `/api/projects/${projectId}/proposals/${t.id}/keep`, {
                        candidateCheckpointId: t.candidateCheckpointId,
                        branchName: (names[t.id] ?? t.title).trim(),
                      }),
                    `Kept as branch "${(names[t.id] ?? t.title).trim()}". Switch to it from Branches.`,
                  )
                }
              >
                Keep as branch
              </button>
              <button
                className={smallButton}
                disabled={busy}
                onClick={() =>
                  void act(() => api("POST", `/api/projects/${projectId}/proposals/${t.id}/reject`))
                }
              >
                Discard
              </button>
            </div>
          )}
        </div>
      ))}
      {notice && <p className="text-[11px] text-zinc-600 dark:text-zinc-400">{notice}</p>}
    </section>
  );
}
