"use client";

import { formatValue, type HistoryCheckpoint } from "./types";

type Status = "added" | "removed" | "changed" | "unchanged";

const key = (e: HistoryCheckpoint["elements"][number]) =>
  String(e.native.data.layerId ?? `${e.kind}:${e.name}`);

const STATUS_ORDER: Record<Status, number> = { changed: 0, added: 1, removed: 2, unchanged: 3 };
const STATUS_LABEL: Record<Status, string> = {
  changed: "changed",
  added: "added",
  removed: "removed",
  unchanged: "",
};
const STATUS_CLASS: Record<Status, string> = {
  changed: "bg-amber-50 dark:bg-amber-950",
  added: "bg-green-50 dark:bg-green-950",
  removed: "bg-red-50 dark:bg-red-950",
  unchanged: "",
};

/** Side-by-side previews plus a property-level comparison from the two manifests. */
export function CompareView({
  left: first,
  right: second,
  onClose,
}: {
  left: HistoryCheckpoint;
  right: HistoryCheckpoint;
  onClose: () => void;
}) {
  // Older checkpoint on the left so changes read "before → after" regardless of selection order.
  const [left, right] =
    new Date(first.createdAt) <= new Date(second.createdAt) ? [first, second] : [second, first];
  const label = (c: HistoryCheckpoint) => c.message ?? `Checkpoint ${c.id.slice(0, 8)}`;

  const ids = [...new Set([...left.elements.map(key), ...right.elements.map(key)])];
  const elements = ids
    .map((id) => {
      const a = left.elements.find((e) => key(e) === id);
      const b = right.elements.find((e) => key(e) === id);
      const types = [
        ...new Set([...(a?.properties ?? []), ...(b?.properties ?? [])].map((p) => p.type)),
      ];
      const rows = types.map((type) => {
        const va = a?.properties.find((p) => p.type === type)?.value;
        const vb = b?.properties.find((p) => p.type === type)?.value;
        const fa = va === undefined ? "" : formatValue(va);
        const fb = vb === undefined ? "" : formatValue(vb);
        return { type, fa, fb, changed: !!a && !!b && fa !== fb };
      });
      const status: Status = !a
        ? "added"
        : !b
          ? "removed"
          : rows.some((r) => r.changed)
            ? "changed"
            : "unchanged";
      const renamed = a && b && a.name !== b.name ? `${a.name} → ${b.name}` : null;
      return { id, name: renamed ?? b?.name ?? a?.name ?? id, kind: (a ?? b)!.kind, status, rows };
    })
    .sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status]);

  const count = (status: Status) => elements.filter((e) => e.status === status).length;
  const summary = (["changed", "added", "removed"] as const)
    .filter((s) => count(s))
    .map((s) => `${count(s)} ${count(s) === 1 ? "layer" : "layers"} ${s}`)
    .join(" · ");

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
                  alt={label(c)}
                  className="w-full rounded border border-zinc-200 dark:border-zinc-700"
                />
              ) : (
                <div className="aspect-[4/3] rounded bg-zinc-100 dark:bg-zinc-800" />
              )}
              <figcaption className="text-xs text-zinc-500">
                {c === left ? "Before" : "After"}: {label(c)} ·{" "}
                {new Date(c.createdAt).toLocaleString()}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="text-sm">{summary || "No supported layer properties differ."}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-2">Layer</th>
                <th className="py-1 pr-2">Property</th>
                <th className="py-1 pr-2">Before: {label(left)}</th>
                <th className="py-1">After: {label(right)}</th>
              </tr>
            </thead>
            {elements.map((e) => (
              <tbody key={e.id} className={STATUS_CLASS[e.status]}>
                {e.rows.map((r, i) => (
                  <tr
                    key={r.type}
                    className={`${i === 0 ? "border-t border-zinc-200 dark:border-zinc-800" : ""} ${
                      r.changed ? "font-semibold" : ""
                    }`}
                  >
                    <td className="py-1 pr-2 align-top">
                      {i === 0 && (
                        <>
                          {e.name}
                          {e.status !== "unchanged" && (
                            <span className="ml-1.5 rounded bg-zinc-200 px-1 py-0.5 text-[10px] font-normal text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                              {STATUS_LABEL[e.status]}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-1 pr-2 font-mono">{r.type}</td>
                    <td className="py-1 pr-2 font-mono">{r.fa}</td>
                    <td className="py-1 font-mono">{r.fb}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          <p className="mt-2 text-[11px] text-zinc-500">
            Layers are matched by their Photoshop layer ID, so renamed layers still line up. Values
            come from each checkpoint&apos;s manifest; pixel-level differences arrive in Phase 7.
          </p>
        </div>
      </div>
    </div>
  );
}
