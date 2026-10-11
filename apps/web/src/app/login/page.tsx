import { Suspense } from "react";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Sign in to Sonder</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
