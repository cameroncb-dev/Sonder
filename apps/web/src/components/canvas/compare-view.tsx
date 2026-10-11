"use client";

import { formatValue, type HistoryCheckpoint } from "./types";

const key = (e: HistoryCheckpoint["elements"][number]) => String(e.native.data.layerId ?? e.name);

/** Side-by-side previews plus a property-level comparison from the two manifests. */
export function CompareView({
  left,
  right,
  onClose,
}: {
  left: HistoryCheckpoint;
  right: HistoryCheckpoint;
  onClose: () => void;
}) {
  const ids = [...new Set([...left.elements.map(key), ...right.elements.map(key)])];
  const rows = ids.flatMap((id) => {
    const a = left.elements.find((e) => key(e) === id);
    const b = right.elements.find((e) => key(e) === id);
    const types = [
      ...new Set([...(a?.properties ?? []), ...(b?.properties ?? [])].map((p) => p.type)),
    ];
    return types.map((type) => {
      const va = a?.properties.find((p) => p.type === type)?.value;
      const vb = b?.properties.find((p) => p.type === type)?.value;
      const fa = va === undefined ? "—" : formatValue(va);
      const fb = vb === undefined ? "—" : formatValue(vb);
      return { element: a?.name ?? b?.name ?? id, type, fa, fb, changed: fa !== fb };
    });
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col gap-4 overflow-auto rounded-lg bg-white p-4 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Compare checkpoints</h2>
          <button
            className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[left, right].map((c) => (
            <figure key={c.id} className="flex flex-col gap-1">
              {c.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img
                  src={c.previewUrl}
                  alt={c.message ?? "Checkpoint"}
                  className="w-full rounded border border-zinc-200 dark:border-zinc-700"
                />
              ) : (
                <div className="aspect-[4/3] rounded bg-zinc-100 dark:bg-zinc-800" />
              )}
              <figcaption className="text-xs text-zinc-500">
                {c.message ?? "Checkpoint"} · {new Date(c.createdAt).toLocaleString()}
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-2">Element</th>
                <th className="py-1 pr-2">Property</th>
                <th className="py-1 pr-2">Left</th>
                <th className="py-1">Right</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.element}-${r.type}`}
                  className={r.changed ? "bg-amber-50 dark:bg-amber-950" : ""}
                >
                  <td className="py-1 pr-2">{r.element}</td>
                  <td className="py-1 pr-2 font-mono">{r.type}</td>
                  <td className="py-1 pr-2 font-mono">{r.fa}</td>
                  <td className="py-1 font-mono">{r.fb}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-zinc-500">
            Highlighted rows differ. Values come from each checkpoint&apos;s manifest; pixel-level
            differences arrive in Phase 7.
          </p>
        </div>
      </div>
    </div>
  );
}
