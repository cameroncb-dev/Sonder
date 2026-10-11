import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Sonder</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        A shared canvas for creative work across applications: checkpoints, branches, comparisons
        and reviews.
      </p>
      <div className="flex gap-3">
        <Link
          className="rounded bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black"
          href="/projects"
        >
          Open projects
        </Link>
        <Link
          className="rounded border border-zinc-300 px-4 py-2 dark:border-zinc-700"
          href="/login"
        >
          Sign in
        </Link>
      </div>
      <p className="text-xs text-zinc-500">
        Service status:{" "}
        <a className="underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}
