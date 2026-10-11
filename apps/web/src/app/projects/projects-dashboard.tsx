"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api, ApiClientError } from "@/lib/api-client";

interface Project {
  id: string;
  name: string;
  created_at: string;
}

/** Card cover gradients drawn from the logo, picked stably per project. */
const COVERS = [
  "from-cyan via-electric to-violet",
  "from-electric via-violet to-magenta",
  "from-magenta via-hotpink to-tangerine",
  "from-hotpink via-tangerine to-gold",
  "from-violet via-magenta to-hotpink",
  "from-cyan via-violet to-hotpink",
];
const cover = (id: string) =>
  COVERS[[...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % COVERS.length];

export function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ projects: Project[] }>("GET", "/api/projects")
      .then((r) => !cancelled && setProjects(r.projects))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiClientError && e.status === 401) setSignedOut(true);
        else setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (creating) input.current?.focus();
  }, [creating]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("POST", "/api/projects", { name });
      setName("");
      setCreating(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const openCreate = () => {
    setError(null);
    setCreating(true);
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-5 py-12 sm:px-8 sm:py-16">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-5xl font-semibold tracking-tight text-white sm:text-6xl">Projects</h1>
          <p className="text-lg text-zinc-400">
            Create, connect, and organize your creative workspaces.
          </p>
        </div>
        {!signedOut && (
          <button type="button" className="btn-sonder !px-6 !py-3" onClick={openCreate}>
            <span aria-hidden className="text-lg leading-none">
              +
            </span>
            New Project
          </button>
        )}
      </header>

      {creating && (
        <form
          onSubmit={create}
          className="gradient-border flex flex-col gap-3 p-5 sm:flex-row sm:items-center"
          onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
        >
          <label className="sr-only" htmlFor="project-name">
            Project name
          </label>
          <input
            id="project-name"
            ref={input}
            className="field flex-1"
            placeholder="Name your project, e.g. Spring Campaign"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="btn-sonder" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create project"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-hotpink/30 bg-hotpink/10 px-4 py-3 text-sm text-pink-200"
        >
          {error}
        </p>
      )}

      {signedOut ? (
        <EmptyState
          title="Sign in to see your projects"
          body="Your projects, boards and document history are waiting for you."
          action={
            <Link href="/login?next=/projects" className="btn-sonder !px-6 !py-3">
              Login
            </Link>
          }
        />
      ) : projects === null ? (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-56 animate-pulse rounded-[1.25rem] bg-white/5" />
          ))}
        </ul>
      ) : projects.length === 0 ? (
        <EmptyState
          title="Your canvas is waiting"
          body="Create a project, then link documents from the Photoshop panel to see them here."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" className="btn-sonder !px-6 !py-3" onClick={openCreate}>
                + New Project
              </button>
              <Link href="/connect" className="btn-ghost !px-6 !py-3">
                How to connect Photoshop
              </Link>
            </div>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="gradient-border group block overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan"
              >
                <div className="dot-grid relative h-36 overflow-hidden rounded-t-[1.2rem] bg-ink">
                  <div
                    className={`absolute -right-6 -top-10 h-40 w-40 rounded-full bg-gradient-to-br ${cover(project.id)} opacity-70 blur-2xl transition-transform duration-500 group-hover:scale-125`}
                  />
                  <div className="absolute bottom-4 left-4 flex gap-2">
                    <span className="h-14 w-11 rounded-md border border-white/10 bg-white/10 backdrop-blur transition-transform duration-300 group-hover:-translate-y-1" />
                    <span className="h-14 w-11 rounded-md border border-white/10 bg-white/10 backdrop-blur transition-transform delay-75 duration-300 group-hover:-translate-y-2" />
                    <span className="h-14 w-11 rounded-md border border-white/10 bg-white/5 backdrop-blur transition-transform delay-150 duration-300 group-hover:-translate-y-1" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 p-5">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-white">{project.name}</div>
                    <div className="mt-0.5 text-xs text-zinc-400">
                      Created {new Date(project.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    aria-hidden
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/5 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:bg-white/10 group-hover:text-white"
                  >
                    →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <section className="dot-grid relative flex flex-col items-center gap-5 overflow-hidden rounded-[2rem] border border-dashed border-white/15 bg-panel/60 px-6 py-20 text-center">
      <div className="relative h-24 w-40">
        <span className="drift absolute left-2 top-4 h-16 w-12 -rotate-6 rounded-lg bg-gradient-to-br from-cyan to-electric opacity-90 shadow-xl" />
        <span className="drift absolute left-14 top-0 h-20 w-14 rounded-lg bg-gradient-to-br from-violet to-magenta shadow-xl [animation-delay:-2s]" />
        <span className="drift absolute left-28 top-6 h-14 w-11 rotate-6 rounded-lg bg-gradient-to-br from-tangerine to-gold opacity-90 shadow-xl [animation-delay:-4s]" />
      </div>
      <h2 className="text-2xl font-semibold text-white">{title}</h2>
      <p className="max-w-md text-zinc-400">{body}</p>
      {action}
    </section>
  );
}
