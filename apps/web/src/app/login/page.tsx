import { Suspense } from "react";

import { SonderLogo } from "@/components/brand/logo";
import { SiteNav } from "@/components/brand/site-nav";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="glow-field flex flex-1 flex-col">
      <SiteNav />
      <main className="flex flex-1 items-center justify-center px-5 py-16">
        <div className="relative w-full max-w-md">
          <div className="bg-sonder absolute -inset-10 -z-10 rounded-full opacity-20 blur-3xl" />
          <div className="animated-ring p-8 shadow-[0_40px_100px_-30px_rgba(59,107,255,0.5)] sm:p-10">
            <div className="flex flex-col items-center gap-4 text-center">
              <SonderLogo size={64} wordmark={false} href={null} />
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">
                  Welcome to Sonder
                </h1>
                <p className="mt-1.5 text-sm text-zinc-400">
                  Sign in to pick up where your team left off.
                </p>
              </div>
            </div>
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}
