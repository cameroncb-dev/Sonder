"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { PairForm } from "../pair/pair-form";

interface Step {
  title: string;
  short: string;
  body: React.ReactNode;
  tip?: string;
}

const STEPS: Step[] = [
  {
    title: "Open Photoshop",
    short: "Open the document",
    body: (
      <>
        Open Adobe Photoshop and make sure the document you want to connect is open and saved as a
        <strong className="text-white"> .psd</strong> file.
      </>
    ),
    tip: "Unsaved new documents can't be linked yet. Save once, then come back.",
  },
  {
    title: "Open the Sonder plugin",
    short: "Plugins → Sonder",
    body: (
      <>
        In Photoshop, choose <Kbd>Plugins</Kbd> → <Kbd>Sonder</Kbd> to open the Sonder panel. You
        can dock it next to your Layers panel.
      </>
    ),
    tip: "Using a development build? Load it from the UXP Developer Tool first.",
  },
  {
    title: "Start pairing",
    short: "Click Connect",
    body: (
      <>
        In the Sonder panel, click <Kbd>Connect</Kbd>. The panel shows a short pairing code like{" "}
        <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-cyan">ABCD-2345</code>.
      </>
    ),
  },
  {
    title: "Sign in to Sonder",
    short: "Use your account",
    body: (
      <>
        Return to the Sonder web app and{" "}
        <Link className="text-cyan underline-offset-2 hover:underline" href="/login?next=/connect">
          sign in
        </Link>{" "}
        to your account. The plugin will act as you, in projects you can edit.
      </>
    ),
  },
  {
    title: "Enter the pairing code",
    short: "Approve the connection",
    body: <>Type the code shown in Photoshop below and approve the connection.</>,
    tip: "Pair once: the connection is remembered for 30 days of use, even after restarting Photoshop.",
  },
  {
    title: "Choose a project",
    short: "Pick where it lives",
    body: (
      <>
        Back in the Sonder panel, pick the project where this document should appear from the
        project list. Click <Kbd>Reload</Kbd> if a new project isn&apos;t listed yet.
      </>
    ),
  },
  {
    title: "Link the document",
    short: "Link active document",
    body: (
      <>
        Click <Kbd>Link active document</Kbd>. The button changes to <Kbd>Linked</Kbd>, and the
        document appears as a card on your project&apos;s canvas.
      </>
    ),
  },
  {
    title: "Capture your first checkpoint",
    short: "Save its starting state",
    body: (
      <>
        Open the project, select the document card and click <Kbd>Capture</Kbd>. Sonder records the
        starting state so you can branch, compare and always get back to it.
      </>
    ),
  },
];

const NOTES = [
  {
    title: "You stay in control",
    body: "Sonder only changes a document after you preview and approve an action.",
    accent: "from-cyan to-electric",
  },
  {
    title: "Nothing is lost",
    body: "Checkpoints make it possible to recover earlier versions at any time.",
    accent: "from-violet to-magenta",
  },
  {
    title: "Works offline from Photoshop",
    body: "If Photoshop is closed or the plugin is disconnected, Sonder still shows your project history. New Photoshop jobs wait until the connector is back.",
    accent: "from-tangerine to-gold",
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[0.85em] font-medium text-white">
      {children}
    </span>
  );
}

/** Guided Photoshop connection: a stepper with the pairing form built into its fifth step. */
export function ConnectExperience({ initialStep = 0 }: { initialStep?: number }) {
  const [active, setActive] = useState(initialStep);
  const [done, setDone] = useState<Set<number>>(
    () => new Set(Array.from({ length: initialStep }, (_, i) => i)),
  );
  const detail = useRef<HTMLElement>(null);
  const step = STEPS[active]!;
  /** On narrow screens the details sit below the list, so bring them into view. */
  const show = (i: number) => {
    setActive(i);
    if (window.matchMedia("(max-width: 1023px)").matches)
      requestAnimationFrame(() =>
        detail.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
  };
  const progress = Math.round((done.size / STEPS.length) * 100);

  const complete = () => {
    setDone((d) => new Set(d).add(active));
    setActive((a) => Math.min(a + 1, STEPS.length - 1));
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-5 pb-24 pt-14 sm:px-8 lg:pt-20">
      <section className="flex max-w-3xl flex-col gap-5">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
          <span className="bg-sonder h-1.5 w-1.5 rounded-full" />
          Adobe Photoshop · about a minute
        </span>
        <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
          Connect Your <span className="text-sonder">Workspace</span>
        </h1>
        <p className="text-lg leading-relaxed text-zinc-300">
          Connecting your workspace to Sonder opens up a whole new world of thinking and
          organization: every document on one canvas, every idea on its own branch.
        </p>
      </section>

      <section aria-label="Connection steps" className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>
              {done.size} of {STEPS.length} done
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="bg-sonder h-full rounded-full transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <ol className="flex flex-col gap-1.5">
            {STEPS.map((s, i) => {
              const isActive = i === active;
              const isDone = done.has(i);
              return (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => show(i)}
                    aria-current={isActive ? "step" : undefined}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-cyan ${
                      isActive
                        ? "border-white/20 bg-white/[0.07] shadow-[0_10px_30px_-15px_rgba(139,92,246,0.6)]"
                        : "border-transparent hover:bg-white/[0.04]"
                    }`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold transition ${
                        isDone
                          ? "bg-gradient-to-br from-cyan to-electric text-white"
                          : isActive
                            ? "bg-sonder text-white"
                            : "border border-white/15 text-zinc-400"
                      }`}
                    >
                      {isDone ? "✓" : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-sm font-medium ${isActive || isDone ? "text-white" : "text-zinc-300"}`}
                      >
                        {s.title}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">{s.short}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <article
          ref={detail}
          key={active}
          className="gradient-border flex min-h-[22rem] scroll-mt-20 flex-col gap-6 p-7 motion-safe:animate-[fade-in_0.35s_ease] sm:p-10"
        >
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <span className="text-sonder font-semibold">Step {active + 1}</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-white">{step.title}</h2>
          <p className="max-w-2xl text-lg leading-relaxed text-zinc-300">{step.body}</p>
          {active === 4 && (
            <div className="max-w-sm">
              <PairForm onPaired={() => setDone((d) => new Set(d).add(4))} />
            </div>
          )}
          {step.tip && (
            <p className="flex max-w-2xl gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
              <span aria-hidden className="text-gold">
                ✦
              </span>
              {step.tip}
            </p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
            {active > 0 && (
              <button type="button" className="btn-ghost" onClick={() => setActive(active - 1)}>
                ← Back
              </button>
            )}
            {active < STEPS.length - 1 ? (
              <button type="button" className="btn-sonder" onClick={complete}>
                {done.has(active) ? "Next step" : "Done, next step"} →
              </button>
            ) : done.has(active) ? (
              <Link href="/projects" className="btn-sonder">
                Go to your projects →
              </Link>
            ) : (
              <button
                type="button"
                className="btn-sonder"
                onClick={() => setDone((d) => new Set(d).add(active))}
              >
                Finish
              </button>
            )}
          </div>
        </article>
      </section>

      <section aria-labelledby="good-to-know" className="flex flex-col gap-6">
        <h2 id="good-to-know" className="text-2xl font-semibold tracking-tight text-white">
          Good to know
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {NOTES.map((n) => (
            <li key={n.title} className="gradient-border flex flex-col gap-3 p-6">
              <span className={`h-1.5 w-12 rounded-full bg-gradient-to-r ${n.accent}`} />
              <h3 className="font-semibold text-white">{n.title}</h3>
              <p className="text-sm leading-relaxed text-zinc-400">{n.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
