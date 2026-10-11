import Link from "next/link";

import { HeroBoard } from "@/components/brand/hero-board";
import { SiteNav } from "@/components/brand/site-nav";

const FEATURES = [
  {
    title: "Organize",
    body: "Lay out documents, notes, references and sections on one shared canvas.",
    accent: "from-cyan to-electric",
    icon: "M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z",
  },
  {
    title: "Branch ideas",
    body: "Explore a new direction without losing the one that already works.",
    accent: "from-electric to-violet",
    icon: "M6 4v10a4 4 0 0 0 4 4h4M6 8a4 4 0 0 0 4 4h4M18 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM18 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  },
  {
    title: "Compare versions",
    body: "See exactly what changed, side by side, then combine the best of each.",
    accent: "from-magenta to-hotpink",
    icon: "M4 5h7v14H4zM13 5h7v14h-7z",
  },
  {
    title: "Connect your tools",
    body: "Pair Photoshop once. Sonder captures checkpoints and applies approved changes.",
    accent: "from-tangerine to-gold",
    icon: "M9 15l6-6M8 11l-2 2a3 3 0 0 0 4 4l2-2M16 13l2-2a3 3 0 0 0-4-4l-2 2",
  },
];

export default function Home() {
  return (
    <div className="glow-field flex flex-1 flex-col">
      <SiteNav />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-24 px-5 pb-24 pt-14 sm:px-8 lg:pt-20">
        <section className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div className="flex flex-col gap-7">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
              <span className="bg-sonder h-1.5 w-1.5 rounded-full" />
              Checkpoints, branches and reviews for creative work
            </span>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
              A visual workspace for <span className="text-sonder">creative direction.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-zinc-300">
              Organize projects, branch ideas, compare versions, and connect your creative tools.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/projects" className="btn-sonder !px-6 !py-3 !text-base">
                Open projects
                <span aria-hidden>→</span>
              </Link>
              <Link href="/connect" className="btn-ghost !px-6 !py-3 !text-base">
                Connect Photoshop
              </Link>
            </div>
          </div>
          <HeroBoard />
        </section>

        <section aria-labelledby="features" className="flex flex-col gap-8">
          <h2
            id="features"
            className="text-2xl font-semibold tracking-tight text-white sm:text-3xl"
          >
            Everything a direction needs, in one place
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="gradient-border group flex flex-col gap-4 p-6">
                <span
                  className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${f.accent} shadow-lg transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="white"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d={f.icon} />
                  </svg>
                </span>
                <h3 className="font-semibold text-white">{f.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-panel p-8 sm:p-12">
          <div className="bg-sonder absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-30 blur-3xl" />
          <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">Bring your first document in</h2>
              <p className="mt-2 max-w-lg text-zinc-400">
                Pair the Photoshop plugin in under a minute. Sonder never changes a file until you
                preview and approve.
              </p>
            </div>
            <Link href="/connect" className="btn-sonder !px-6 !py-3">
              Connect your workspace
            </Link>
          </div>
        </section>
      </main>
      <footer className="border-t border-white/5 py-6 text-center text-xs text-zinc-500">
        Sonder ·{" "}
        <a className="underline-offset-2 hover:text-zinc-300 hover:underline" href="/api/health">
          Service status
        </a>
      </footer>
    </div>
  );
}
