"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(mode: "signIn" | "signUp") {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { data, error } =
      mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
            },
          });
    setBusy(false);
    if (error) return setMessage(error.message);
    if (mode === "signUp" && !data.session)
      return setMessage("Check your email to confirm your account.");
    router.replace(next);
    router.refresh();
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit("signIn");
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button
          className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
          disabled={busy}
        >
          Sign in
        </button>
        <button
          type="button"
          className="rounded border border-zinc-300 px-4 py-2 disabled:opacity-50 dark:border-zinc-700"
          disabled={busy}
          onClick={() => void submit("signUp")}
        >
          Create account
        </button>
      </div>
      {message && <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>}
    </form>
  );
}
