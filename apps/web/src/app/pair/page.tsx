import { PairForm } from "./pair-form";

export default function PairPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Connect a plugin</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Enter the code shown in the Sonder panel. The plugin will act as you in projects you can
          edit, until its session expires.
        </p>
      </div>
      <PairForm />
    </main>
  );
}
