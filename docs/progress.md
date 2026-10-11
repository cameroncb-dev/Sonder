# Progress

## Phase 2 — Connector Contract and Photoshop Feasibility

Status: **complete.** All acceptance criteria are verified in Photoshop 27.8.0. Branch:
`phase-2-connector`.

### Completed

| Task                                     | Result                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Test PSD with text and solid background  | `dev/fixture.ts` builds it in Photoshop: 800×600 RGB 72 ppi, `Background Color` fill, `Headline` and `Body` text |
| Capability reporting                     | `photoshopManifest()`, validated against `ConnectorManifest`                                                     |
| Discover supported layers                | `readElements`: text and solid-fill layers, including inside groups                                              |
| Assign and validate roles                | `validateMappings`: existence by layer id, kind, editability                                                     |
| Read supported properties                | content, font (PostScript name + family/style), size, text color, fill color                                     |
| Change headline font                     | DOM `characterStyle.font`, verified by read-back                                                                 |
| Change background color                  | `batchPlay` select + `set contentLayer` (targetEnum), verified by read-back                                      |
| Editable copy without overwriting source | `createCandidate` works on a copy of the snapshot; source bytes unchanged                                        |
| Export a preview                         | `saveAs.png` as copy                                                                                             |
| Save and reopen a native snapshot        | `captureCheckpoint` + `openCheckpoint` (opens a copy, never the snapshot)                                        |

### Files added or changed

- `packages/contracts/` (new): Zod schemas and tests.
- `packages/connector-sdk/` (new): connector interface, errors, validation, digest, diff, tests.
- `connectors/photoshop/`: TypeScript sources in `src/` (`core/` pure logic with tests, `ps/`
  Photoshop calls, `connector.ts`, `dev/` fixture, suite and trigger, `panel.ts`), `build.mjs`
  (esbuild), `tsconfig.json`. `plugin/index.js` was replaced by the `plugin/dist/panel.js` bundle.
- `tsconfig.base.json` (new), root `package.json` (TypeScript and Vitest dev dependencies),
  `.gitignore` (`plugin/dist/`).
- No database migrations.

### Verification performed (actual results)

| Check                                                             | Result                                                                                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                | Pass                                                                                                                                                              |
| `pnpm test`                                                       | 24/24: web 6, contracts 5, connector-sdk 7, photoshop core 6                                                                                                      |
| Feasibility suite in Photoshop 27.8.0 (runs `r215426`, `r215531`) | **14/14 pass, twice**                                                                                                                                             |
| Read-back of fixture                                              | `Headline`: "Sonder Poster", `ArialMT`, 64 pt, `#FFFFFF`, editable; background `#1E3A5F`; 800×600, 72 ppi, `RGBColorMode`                                         |
| Candidate                                                         | Headline font `ArialMT` → `Georgia`; background `#1E3A5F` → `#8B1E3F`; body and headline content unchanged                                                        |
| Source intact                                                     | `source.psd` digest `f6ab4cc0001d7331` identical before and after candidate creation                                                                              |
| Candidate editable                                                | Reopened candidate matches its manifest; headline still a live text layer and accepted a text edit                                                                |
| Reopened source snapshot                                          | Elements identical to the manifest (no differences)                                                                                                               |
| Missing font                                                      | `MISSING_FONT` from `validateProposal` and `createCandidate`; no candidate checkpoint written                                                                     |
| Missing layer                                                     | Deleting `Body` → `ELEMENT_NOT_FOUND` naming role, layer and id                                                                                                   |
| Wrong kind / incomplete checkpoint                                | `ELEMENT_KIND_MISMATCH`; snapshot without manifest → `CHECKPOINT_INCOMPLETE`                                                                                      |
| Independent artifact checks (outside the plugin)                  | Previews viewed: source Arial on navy, candidate Georgia on maroon. PSD bytes: both keep 4 layers and 2 live text blocks; only the candidate references `Georgia` |

### Problems found and fixed during verification

- Photoshop 27.8 ignores `createTextLayer({ name })`, so the fixture renames layers after
  creating them.
- `set contentLayer` addressed by `_id` silently did nothing. The read-back check reported it as
  `APPLICATION_ERROR` instead of a false success. Fixed by selecting the layer and targeting it.

### Known limitations

- Mixed-formatting detection (`hasMixedFormatting`) is unit-tested, but no mixed-format PSD has
  been tried in Photoshop yet.
- `discoverAssets` is implemented but not exercised by the suite.
- Unsupported color modes are rejected by validation, but no CMYK document has been tested.
- The suite keeps every run's artifacts (about 1.5 MB per run) in the plugin data folder. Delete
  `feasibility/run-*` folders as needed.
- `@types/photoshop` is pinned to 25.0.4 (the 27.x typings were too new to adopt). Runtime
  behavior was verified on 27.8.0.
- Vitest warns about an unmet `@types/node` peer (the web app pins `^20`). Harmless.

### Recommended next phase

Phase 3 (persistence, permissions, and jobs): store checkpoints in Supabase and deliver
connector jobs to the paired plugin.

## Phase 1 — Collect Components and Configure Services

Status: **complete.** All acceptance criteria are met; see the verification table.

### Environment found

macOS (Darwin 25.5), Node 24.2.0, pnpm 10.12.4, Python 3.12.12 (also 3.11, 3.13, 3.14),
Supabase CLI 2.75.0, Docker 29.1.3, Photoshop 2021, 2025 and **2026 (27.8.0)**. Not present:
`uv`, UXP Developer Tool (installed later: 2.3.0), Supabase CLI login (logged in and linked later in Phase 1).

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

| Check                                                              | Result                                                                                                                                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                                     | Resolved                                                                                                                                                                         |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                 | Pass                                                                                                                                                                             |
| `pnpm test` (Vitest)                                               | 6/6 pass (env parsing, LLM disabled states)                                                                                                                                      |
| `pnpm --filter web build`                                          | Pass                                                                                                                                                                             |
| Vision `pytest`                                                    | 6/6 pass (public health, 401 without token, 503 when unconfigured, decode, 422, 413)                                                                                             |
| Vision `ruff check`, `ruff format --check`, `mypy src`             | Pass                                                                                                                                                                             |
| Web dev server + vision server started                             | Both served requests                                                                                                                                                             |
| Backend → vision                                                   | `/api/health` returned `vision.reachable: true, authenticated: true`                                                                                                             |
| Vision live: unauthenticated inspect                               | 401                                                                                                                                                                              |
| Vision live: 25 MB upload                                          | 413                                                                                                                                                                              |
| `/auth/callback` without a code                                    | 307 to `/?auth_error=callback_failed`                                                                                                                                            |
| **Local** Supabase (`supabase start`, Docker)                      | Migration applied; 3 private buckets and 3 policies present                                                                                                                      |
| `pnpm --filter web verify:supabase` against local stack            | 10/10 pass: connectivity, private buckets, sign-in, own-folder upload/download, cross-user upload denied, anonymous download denied                                              |
| **Hosted** Supabase project `Sonder` (`rihciqpkzdzpdsxmyaut`)      | Linked; confirmed empty first (no buckets, public tables or users); `supabase db push` applied the migration                                                                     |
| `pnpm --filter web verify:supabase` against hosted project         | 10/10 pass with the `sb_secret_…` key from `.env.local`; temporary user and file removed afterwards                                                                              |
| Hosted auth URL configuration (Management API + magic link test)   | Site URL `http://localhost:3000`, allow-list `http://localhost:3000/auth/callback`; allow-listed redirect honored, unlisted `https://evil.example.com` fell back to the Site URL |
| Photoshop plugin load (UXP Developer Tool 2.3.0, Photoshop 27.8.0) | `Load command successful`; panel showed `Photoshop 27.8.0`, the active document's name, and `Backend: reachable` (plain-`http` fetch to `localhost:3000` works)                  |
| Web `/api/health` with hosted config                               | `supabase.configured: true`                                                                                                                                                      |

### Not verified

- **Real sign-in flow.** No OAuth provider or email delivery is configured. Only the callback's
  failure path and password sign-in (via the verification script) were exercised.

### Blockers requiring user input

1. **LLM provider (optional).** Language interpretation stays disabled until a provider and
   key are supplied. That isn't needed until Phase 8.

### Known limitations

- **Photoshop Developer Mode.** Loading a plugin needs Photoshop → Settings → Plugins → **Enable
  Developer Mode**, followed by a restart. With it off, Photoshop logs only
  `Plugin rejected - <id> due to invalid object`, even for Adobe's own templates. The UXP
  Developer Tool's system-wide developer flag is not enough on its own.
- The plugin manifest allows only `http://localhost:3000`. Photoshop rejected the earlier
  version, which had no icons and also allowed `127.0.0.1`, while Developer Mode was off. The
  current form is the one verified to load, so the original version was never tested with
  Developer Mode on.

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
