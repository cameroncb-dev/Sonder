"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SonderLogo } from "./logo";

const LINKS = [
  { href: "/projects", label: "Projects" },
  { href: "/connect", label: "Connect" },
  { href: "/login", label: "Login" },
] as const;

/** Top navigation for the site pages: Projects, Connect, Login, in that order. */
export function SiteNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-ink/70 backdrop-blur-xl">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-8"
      >
        <SonderLogo />
        <ul className="flex items-center gap-0.5 sm:gap-2">
          {LINKS.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const login = href === "/login";
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={
                    login
                      ? "btn-ghost !px-3.5 !py-1.5"
                      : `relative rounded-full px-2.5 py-1.5 text-sm sm:px-3 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-cyan ${
                          active ? "text-white" : "text-zinc-400 hover:text-white"
                        }`
                  }
                >
                  {label}
                  {active && !login && (
                    <span className="bg-sonder absolute inset-x-2.5 -bottom-[1px] sm:inset-x-3 h-0.5 rounded-full" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
