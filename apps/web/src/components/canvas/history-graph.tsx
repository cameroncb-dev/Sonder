"use client";

import type { Branch, HistoryCheckpoint } from "./types";

const ROW = 64;
const LANE = 18;

/**
 * Commit-graph style history: one lane per line of descent. Edges come only
 * from checkpoint parent links, never from canvas connections.
 */
export function HistoryGraph({
  checkpoints,
  branches,
  activeBranchId,
  selected,
  compare,
  onSelect,
  onToggleCompare,
}: {
  checkpoints: HistoryCheckpoint[];
  branches: Branch[];
  activeBranchId: string | null;
  selected: string | null;
  compare: string[];
  onSelect: (id: string) => void;
  onToggleCompare: (id: string) => void;
}) {
  const ordered = [...checkpoints].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lane = new Map<string, number>();
  const continued = new Set<string>();
  let lanes = 0;
  for (const c of ordered) {
    const parent = c.parents[0];
    if (parent && lane.has(parent) && !continued.has(parent)) {
      lane.set(c.id, lane.get(parent)!);
      continued.add(parent);
    } else {
      lane.set(c.id, lanes++);
    }
  }
  const rows = [...ordered].reverse();
  const row = new Map(rows.map((c, i) => [c.id, i]));
  const x = (id: string) => 10 + (lane.get(id) ?? 0) * LANE;
  const y = (id: string) => ROW / 2 + (row.get(id) ?? 0) * ROW;
  const width = 20 + Math.max(lanes, 1) * LANE;

  return (
    <div className="relative" style={{ height: rows.length * ROW }}>
      <svg className="absolute left-0 top-0" width={width} height={rows.length * ROW} aria-hidden>
        {rows.flatMap((c) =>
          c.parents
            .filter((p) => row.has(p))
            .map((p) => (
              <path
                key={`${c.id}-${p}`}
                d={`M ${x(c.id)} ${y(c.id)} C ${x(c.id)} ${y(c.id) + ROW / 2}, ${x(p)} ${y(p) - ROW / 2}, ${x(p)} ${y(p)}`}
                className="fill-none stroke-zinc-400"
                strokeWidth={2}
              />
            )),
        )}
        {rows.map((c) => (
          <circle
            key={c.id}
            cx={x(c.id)}
            cy={y(c.id)}
            r={5}
            className={selected === c.id ? "fill-blue-500" : "fill-zinc-500"}
          />
        ))}
      </svg>
      {rows.map((c) => {
        const heads = branches.filter((b) => b.head_checkpoint_id === c.id);
        return (
          <div
            key={c.id}
            className={`absolute right-0 flex cursor-pointer items-center gap-2 rounded px-2 ${selected === c.id ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
            style={{ top: (row.get(c.id) ?? 0) * ROW + 4, height: ROW - 8, left: width }}
            onClick={() => onSelect(c.id)}
          >
            {c.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img
                src={c.previewUrl}
                alt=""
                className="h-10 w-12 shrink-0 rounded border border-zinc-200 object-cover dark:border-zinc-700"
              />
            ) : (
              <div className="h-10 w-12 shrink-0 rounded bg-zinc-100 dark:bg-zinc-800" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{c.message ?? "Checkpoint"}</div>
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
                {new Date(c.createdAt).toLocaleString()}
                {heads.map((b) => (
                  <span
                    key={b.id}
                    className={`rounded px-1 font-mono ${b.id === activeBranchId ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-zinc-100 dark:bg-zinc-800"}`}
                  >
                    {b.name}
                    {b.id === activeBranchId ? " ●" : ""}
                  </span>
                ))}
              </div>
            </div>
            <input
              type="checkbox"
              title="Select for comparison"
              checked={compare.includes(c.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleCompare(c.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
