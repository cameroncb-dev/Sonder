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
      className="mt-8 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit("signIn");
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
        Email
        <input
          className="field"
          type="email"
          autoComplete="email"
          placeholder="you@studio.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-300">
        Password
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          placeholder="At least 8 characters"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button className="btn-sonder mt-2 w-full !py-3" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <button
        type="button"
        className="btn-ghost w-full !py-3"
        disabled={busy}
        onClick={() => void submit("signUp")}
      >
        Create account
      </button>
      {message && (
        <p
          role="status"
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center text-sm text-zinc-300"
        >
          {message}
        </p>
      )}
    </form>
  );
}
