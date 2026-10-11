# Progress

## Phase 1 — Collect Components and Configure Services

Status: **complete except for the Photoshop runtime check**, which is blocked on installing the UXP
Developer Tool.

### Environment found

macOS (Darwin 25.5), Node 24.2.0, pnpm 10.12.4, Python 3.12.12 (also 3.11, 3.13, 3.14),
Supabase CLI 2.75.0, Docker 29.1.3, Photoshop 2021, 2025 and **2026 (27.8.0)**. Not present:
`uv`, UXP Developer Tool, Supabase CLI login (logged in and linked later in Phase 1).

### Completed

| Task                                           | Result                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| pnpm workspace                                 | Root `package.json` + `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `connectors/*`), `pnpm-lock.yaml` committed                |
| Next.js + TypeScript + Tailwind                | `apps/web`: Next 16.4.0, React 19.3.0, Tailwind 4, TypeScript 5.9                                                               |
| React Flow, Supabase, Zod, Vitest              | `@xyflow/react` 12.12.0, `@supabase/supabase-js` 2.117.3, `@supabase/ssr` 0.12.7, `zod` 4.6.5, `vitest` 5.0.3                   |
| Python environment                             | `services/vision/.venv` (Python 3.12); `requirements.lock` and `requirements-dev.lock` with hashes                              |
| FastAPI, ASGI, OpenCV, NumPy, Pydantic, pytest | FastAPI 0.143.0, Uvicorn 0.54.0, opencv-python-headless 5.0.0, NumPy 2.5.4, Pydantic 2.14.0, pytest 9.1.1                       |
| Formatting, linting, type checks, tests        | Prettier, ESLint (next config), `tsc` via `next typegen`, Vitest; ruff, mypy (strict), pytest                                   |
| Env examples and secret exclusions             | `apps/web/.env.example`, `services/vision/.env.example`; root `.gitignore` ignores all `.env*` except examples                  |
| Supabase migration tooling                     | `supabase/config.toml`; auth site URL and `/auth/callback` redirect configured for local development                            |
| Private buckets + policies                     | Migration `20261010000000_private_storage_buckets.sql`: `snapshots`, `previews`, `references`, owner-only, write-once           |
| Dev auth + callback                            | `src/proxy.ts` refreshes the session; `src/app/auth/callback/route.ts` exchanges the code and only allows same-origin redirects |
| Admin credentials server-side                  | `createAdminClient` in a `server-only` module; plugin and browser never receive it                                              |
| Health endpoints                               | `GET /api/health` (web) reports vision, Supabase and LLM status; `GET /health` (vision)                                         |
| Vision auth                                    | Bearer token with constant-time comparison; protected routes return 503 if no token is configured                               |
| Upload limits                                  | ASGI body limit (default 20 MiB) by `Content-Length` and while streaming; OpenCV decode limit (default 50 MP)                   |
| LLM adapter                                    | `src/server/llm`: provider-independent `LanguageInterpreter`; disabled by default; no provider implementation                   |
| Photoshop plugin scaffold                      | `connectors/photoshop/plugin`: manifest v5, panel reads the active document name and pings the backend                          |
| Docs                                           | `setup.md`, `architecture.md`, `connector-contract.md`, this file                                                               |

### Verification performed (actual results)

| Check                                                            | Result                                                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                                   | Resolved                                                                                                                                                                         |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`               | Pass                                                                                                                                                                             |
| `pnpm test` (Vitest)                                             | 6/6 pass (env parsing, LLM disabled states)                                                                                                                                      |
| `pnpm --filter web build`                                        | Pass                                                                                                                                                                             |
| Vision `pytest`                                                  | 6/6 pass (public health, 401 without token, 503 when unconfigured, decode, 422, 413)                                                                                             |
| Vision `ruff check`, `ruff format --check`, `mypy src`           | Pass                                                                                                                                                                             |
| Web dev server + vision server started                           | Both served requests                                                                                                                                                             |
| Backend → vision                                                 | `/api/health` returned `vision.reachable: true, authenticated: true`                                                                                                             |
| Vision live: unauthenticated inspect                             | 401                                                                                                                                                                              |
| Vision live: 25 MB upload                                        | 413                                                                                                                                                                              |
| `/auth/callback` without a code                                  | 307 to `/?auth_error=callback_failed`                                                                                                                                            |
| **Local** Supabase (`supabase start`, Docker)                    | Migration applied; 3 private buckets and 3 policies present                                                                                                                      |
| `pnpm --filter web verify:supabase` against local stack          | 10/10 pass: connectivity, private buckets, sign-in, own-folder upload/download, cross-user upload denied, anonymous download denied                                              |
| **Hosted** Supabase project `Sonder` (`rihciqpkzdzpdsxmyaut`)    | Linked; confirmed empty first (no buckets, public tables or users); `supabase db push` applied the migration                                                                     |
| `pnpm --filter web verify:supabase` against hosted project       | 10/10 pass with the `sb_secret_…` key from `.env.local`; temporary user and file removed afterwards                                                                              |
| Hosted auth URL configuration (Management API + magic link test) | Site URL `http://localhost:3000`, allow-list `http://localhost:3000/auth/callback`; allow-listed redirect honored, unlisted `https://evil.example.com` fell back to the Site URL |
| Web `/api/health` with hosted config                             | `supabase.configured: true`                                                                                                                                                      |

### Not verified

- **Photoshop plugin loading.** UXP Developer Tool isn't installed, so the plugin has not been
  loaded in Photoshop and reading the active document name hasn't run. Also unverified: whether
  UXP allows plain-`http` `fetch` to `localhost` with the declared `network.domains`.
- **Real sign-in flow.** No OAuth provider or email delivery is configured. Only the callback's
  failure path and password sign-in (via the verification script) were exercised.

### Blockers requiring user input

1. **UXP Developer Tool.** Install it from Creative Cloud, load
   `connectors/photoshop/plugin/manifest.json` in Photoshop 2026, and confirm the panel shows
   the document name (see `docs/setup.md` §5).
2. **LLM provider (optional).** Language interpretation stays disabled until a provider and
   key are supplied. That isn't needed until Phase 8.

### Known limitations

- Phase 1 storage policies are owner-only (`<uid>/…` paths). Project-membership policies come
  in Phase 3.
- The `snapshots` bucket is capped at 50 MiB, the free-plan global limit. Larger PSDs need a
  plan change; ask before making one.
- The starlette test client warns that `httpx` is deprecated in favor of `httpx2`. Tests pass
  anyway.
- Supabase CLI 2.75.0 is installed and 2.120.0 is available. It wasn't upgraded.
- `next dev` (re)writes `apps/web/AGENTS.md`. It's committed so the tree stays clean.

### Recommended next phase

Phase 2 (connector contract and Photoshop feasibility), once blocker 2 is resolved. Phase 2
can't be satisfied with simulated operations.
