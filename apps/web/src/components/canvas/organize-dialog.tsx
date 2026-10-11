"use client";

import { useState } from "react";

import { api } from "@/lib/api-client";
import { COLOR_STYLES, type CanvasColor } from "@/lib/canvas-style";

export interface OrganizePlan {
  moves: Array<{
    itemId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    title?: string;
    color?: string;
  }>;
  newSections: Array<{
    title: string;
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  connections: Array<{ from: string; to: string; why?: string }>;
  summary?: { text: string; x: number; y: number };
  groups: Array<{ title: string; color: string; cards: string[] }>;
}

/**
 * Asks Gemini how to group the board and previews the result. Nothing moves until Apply,
 * and applying can be undone.
 */
export function OrganizeDialog({
  projectId,
  onCancel,
  onApply,
}: {
  projectId: string;
  onCancel: () => void;
  onApply: (plan: OrganizePlan) => void;
}) {
  const [hint, setHint] = useState("");
  const [plan, setPlan] = useState<OrganizePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ plan: OrganizePlan }>(
        "POST",
        `/api/projects/${projectId}/canvas/organize`,
        hint.trim() ? { hint: hint.trim() } : {},
      );
      setPlan(r.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-auto rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold">Organize board</h2>
        <p className="text-xs text-zinc-500">
          Gemini groups your cards into titled sections and suggests connections. You see the plan
          first; nothing moves until you apply it, and you can undo it. Documents and their history
          aren&apos;t touched.
        </p>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="Optional: e.g. group by client feedback vs. explorations"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
          <button
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={busy}
            onClick={() => void ask()}
          >
            {busy ? "Thinking…" : plan ? "Ask again" : "Ask Gemini"}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}

        {plan && (
          <div className="flex flex-col gap-3">
            {plan.groups.map((g) => (
              <div key={g.title} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className={`h-3 w-3 rounded-full ${COLOR_STYLES[(g.color as CanvasColor) in COLOR_STYLES ? (g.color as CanvasColor) : "grey"].swatch}`}
                  />
                  {g.title}
                </div>
                <p className="text-xs text-zinc-500">{g.cards.join(" · ")}</p>
              </div>
            ))}
            {plan.connections.length > 0 && (
              <p className="text-xs text-zinc-500">
                {plan.connections.length} new{" "}
                {plan.connections.length === 1 ? "connection" : "connections"}
                {plan.connections.some((c) => c.why)
                  ? `: ${plan.connections
                      .map((c) => c.why)
                      .filter(Boolean)
                      .join("; ")}`
                  : ""}
              </p>
            )}
            {plan.summary && (
              <p className="rounded bg-yellow-50 p-2 text-xs text-yellow-950 dark:bg-yellow-900/40 dark:text-yellow-50">
                Summary note: {plan.summary.text}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="rounded bg-zinc-200 px-4 py-1.5 text-sm text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={!plan}
            onClick={() => plan && onApply(plan)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
