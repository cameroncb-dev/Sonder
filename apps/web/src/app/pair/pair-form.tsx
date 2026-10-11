"use client";

import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; detail: string }
  | { kind: "error"; message: string; signIn?: boolean };

export function PairForm() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function approve() {
    setState({ kind: "busy" });
    const response = await fetch("/api/connector/pair/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      session?: { application: string; applicationVersion?: string };
      error?: { message: string };
    };
    if (response.status === 401)
      return setState({ kind: "error", message: "Sign in first.", signIn: true });
    if (!response.ok || !body.session) {
      return setState({ kind: "error", message: body.error?.message ?? "Pairing failed" });
    }
    setState({
      kind: "done",
      detail: `${body.session.application} ${body.session.applicationVersion ?? ""}`.trim(),
    });
  }

  if (state.kind === "done") {
    return <p className="text-sm">Connected {state.detail}. You can return to the plugin.</p>;
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void approve();
      }}
    >
      <input
        className="rounded border border-zinc-300 px-3 py-2 text-center font-mono text-lg tracking-widest uppercase dark:border-zinc-700 dark:bg-zinc-900"
        placeholder="ABCD-2345"
        required
        pattern="[A-Za-z2-9]{4}-[A-Za-z2-9]{4}"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <button
        className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
        disabled={state.kind === "busy"}
      >
        Approve
      </button>
      {state.kind === "error" && (
        <p className="text-sm text-red-600">
          {state.message}{" "}
          {state.signIn && (
            <a className="underline" href="/login?next=/pair">
              Sign in
            </a>
          )}
        </p>
      )}
    </form>
  );
}
