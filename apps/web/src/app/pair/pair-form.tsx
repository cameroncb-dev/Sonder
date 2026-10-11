"use client";

import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; detail: string }
  | { kind: "error"; message: string; signIn?: boolean };

export function PairForm({ onPaired }: { onPaired?: () => void } = {}) {
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
    onPaired?.();
    setState({
      kind: "done",
      detail: `${body.session.application} ${body.session.applicationVersion ?? ""}`.trim(),
    });
  }

  if (state.kind === "done") {
    return (
      <p
        role="status"
        className="rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-3 text-sm text-cyan-100"
      >
        ✓ Connected {state.detail}. Return to the plugin to choose a project.
      </p>
    );
  }
  return (
    <form
      className="flex flex-col flex-wrap gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        void approve();
      }}
    >
      <input
        className="field flex-1 text-center font-mono !text-lg tracking-[0.3em] uppercase"
        aria-label="Pairing code"
        placeholder="ABCD-2345"
        required
        pattern="[A-Za-z2-9]{4}-[A-Za-z2-9]{4}"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <button className="btn-sonder !py-3" disabled={state.kind === "busy"}>
        {state.kind === "busy" ? "Approving…" : "Approve"}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-pink-300 sm:basis-full">
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
