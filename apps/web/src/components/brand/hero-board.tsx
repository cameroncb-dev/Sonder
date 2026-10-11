"use client";

import { useRef, useState } from "react";

const VERSIONS = [
  { id: "a", label: "Main · v3", hue: "from-cyan/80 to-electric/80", x: 6, y: 34 },
  { id: "b", label: "Warm launch", hue: "from-tangerine/90 to-hotpink/80", x: 42, y: 14 },
  { id: "c", label: "Night edition", hue: "from-violet/90 to-magenta/80", x: 42, y: 56 },
] as const;

/**
 * A small, playful board for the landing page: cards drift with the pointer at different
 * depths, and hovering a branch highlights its path from the main version.
 */
export function HeroBoard() {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  function move(event: React.PointerEvent) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    ref.current!.style.setProperty("--mx", x.toFixed(3));
    ref.current!.style.setProperty("--my", y.toFixed(3));
  }
  const depth = (d: number) => ({
    transform: `translate3d(calc(var(--mx, 0) * ${d}px), calc(var(--my, 0) * ${d}px), 0)`,
  });

  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={() => {
        ref.current?.style.setProperty("--mx", "0");
        ref.current?.style.setProperty("--my", "0");
      }}
      className="dot-grid relative aspect-[5/4] w-full overflow-hidden rounded-[1.75rem] border border-white/10 bg-panel/80 shadow-[0_40px_120px_-40px_rgba(59,107,255,0.45)]"
      aria-label="Illustration of a Sonder board with three versions of a poster"
      role="img"
    >
      {/* Window chrome */}
      <div className="absolute inset-x-0 top-0 flex h-10 items-center gap-1.5 border-b border-white/5 bg-ink/60 px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-hotpink/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-gold/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-cyan/70" />
        <span className="ml-3 text-[11px] text-zinc-400">Spring Campaign · Board</span>
        <span className="ml-auto rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
          84%
        </span>
      </div>

      {/* Branch lines */}
      <svg
        className="absolute inset-0 h-full w-full transition-transform duration-300 ease-out"
        style={depth(10)}
        viewBox="0 0 100 80"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="hero-line" x1="0" x2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="0.5" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#ff3d8b" />
          </linearGradient>
        </defs>
        {[
          { id: "b", d: "M 32 37 C 37 37, 37 23, 42 23" },
          { id: "c", d: "M 32 40 C 37 40, 37 56, 42 56" },
        ].map((p) => (
          <path
            key={p.id}
            d={p.d}
            fill="none"
            stroke="url(#hero-line)"
            strokeWidth={hovered === p.id ? 0.9 : 0.45}
            strokeDasharray="1.6 1.2"
            vectorEffect="non-scaling-stroke"
            className="transition-all duration-300"
            style={{ opacity: hovered && hovered !== p.id ? 0.25 : 0.9 }}
          />
        ))}
      </svg>

      {/* Version cards */}
      {VERSIONS.map((v, i) => (
        <div
          key={v.id}
          className="absolute w-[26%] transition-transform duration-300 ease-out"
          style={{ left: `${v.x}%`, top: `${v.y}%`, ...depth(18 + i * 10) }}
        >
          <button
            type="button"
            tabIndex={-1}
            onPointerEnter={() => setHovered(v.id)}
            onPointerLeave={() => setHovered(null)}
            className="group block w-full rounded-xl border border-white/10 bg-zinc-900/90 p-2 text-left shadow-xl transition duration-300 hover:-translate-y-1 hover:border-white/30 hover:shadow-[0_20px_40px_-12px_rgba(224,64,251,0.45)]"
          >
            <div
              className={`relative aspect-[4/3] overflow-hidden rounded-lg bg-gradient-to-br ${v.hue}`}
            >
              <div className="absolute left-[12%] top-[14%] h-[6%] w-[55%] rounded-sm bg-white/85" />
              <div className="absolute left-[12%] top-[24%] h-[4%] w-[35%] rounded-sm bg-white/50" />
              <div className="absolute bottom-[12%] right-[12%] h-[30%] w-[30%] rounded-full bg-white/25 blur-[1px]" />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-1">
              <span className="truncate text-[10px] font-medium text-zinc-200 sm:text-xs">
                {v.label}
              </span>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan shadow-[0_0_8px_#22d3ee]" />
            </div>
          </button>
        </div>
      ))}

      {/* Sticky note */}
      <div
        className="absolute right-[5%] top-[18%] w-[19%] transition-transform duration-300 ease-out"
        style={depth(40)}
      >
        <div className="drift rotate-3 rounded-md bg-gold p-2 text-[9px] font-medium leading-snug text-zinc-900 shadow-lg sm:text-[11px]">
          Client loves the warm one. Try it on the flyer too?
        </div>
      </div>

      {/* Compare chip */}
      <div
        className="absolute bottom-[6%] right-[6%] transition-transform duration-300 ease-out"
        style={depth(28)}
      >
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-ink/80 px-3 py-1.5 text-[10px] text-zinc-300 shadow-lg backdrop-blur sm:text-xs">
          <span className="bg-sonder h-2 w-2 rounded-full" />
          Comparing 2 versions
        </div>
      </div>
    </div>
  );
}
