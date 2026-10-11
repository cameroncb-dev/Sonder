"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";

interface Project {
  id: string;
  name: string;
  created_at: string;
}

export function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ projects: Project[] }>("GET", "/api/projects")
      .then((r) => !cancelled && setProjects(r.projects))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api("POST", "/api/projects", { name });
      setName("");
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-zinc-500">
            Each project is a shared canvas of connected documents.
          </p>
        </div>
        <form onSubmit={create} className="flex gap-2">
          <input
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="New project name"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="rounded bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-black">
            Create
          </button>
        </form>
      </header>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {projects === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No projects yet. Create one, then link documents from the Photoshop panel.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="block rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <div className="font-medium">{project.name}</div>
                <div className="text-xs text-zinc-500">
                  Created {new Date(project.created_at).toLocaleDateString()}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
