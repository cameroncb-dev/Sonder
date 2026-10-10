export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Sonder</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Collaborative visual workspace for creative projects. Phase 1 environment setup — product
        features are not built yet.
      </p>
      <p className="text-sm text-zinc-500">
        Service status:{" "}
        <a className="underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}
