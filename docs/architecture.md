# Architecture

Sonder is a collaborative canvas for creative work spread across several applications. The demo
implements one connector (Photoshop). The shared systems (projects, history, canvas, review,
jobs) must not assume Photoshop.

```mermaid
flowchart LR
  Browser["Browser<br/>Next.js UI + React Flow"] -->|cookies session| Web["Web backend<br/>Next.js route handlers"]
  Plugin["Photoshop UXP plugin<br/>(connector)"] -->|connector session token<br/>(Phase 3)| Web
  Web -->|publishable key + user JWT, RLS| SB[("Supabase<br/>Postgres · Auth · Storage")]
  Web -->|secret key, server-only| SB
  Web -->|bearer service token| Vision["Vision service<br/>FastAPI + OpenCV"]
  Web -->|server-side key| LLM["LLM provider<br/>(optional)"]
```

## Components

| Component        | Location                      | Responsibility                                                                                                                               |
| ---------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app          | `apps/web`                    | UI, route handlers, authorization, proposal orchestration, connector jobs                                                                    |
| Vision service   | `services/vision`             | Palette extraction and visual diffs (Phase 7). Only the web backend calls it.                                                                |
| Photoshop plugin | `connectors/photoshop/plugin` | Reads and modifies Photoshop documents, captures snapshots and previews                                                                      |
| Shared packages  | `packages/*`                  | `contracts` (Zod schemas) and `connector-sdk` (Phase 2); `merge-engine` comes in Phase 5. They must run in UXP, so no Node or DOM-only APIs. |
| Database         | `supabase/migrations`         | Schema, RLS and storage policies                                                                                                             |

## Trust boundaries

- **Browser**: uses only the publishable key. All data access goes through RLS or web route
  handlers.
- **Photoshop plugin**: never holds Supabase admin credentials. From Phase 3 it uses short-lived
  connector session credentials, issued after pairing with a signed-in user. It talks only to
  the web backend.
- **Vision service**: not public. Every endpoint except `/health` requires the shared bearer
  token, and it refuses requests if no token is configured. It enforces a request-size limit
  (default 20 MiB) and a decoded-pixel limit (default 50 MP).
- **LLM adapter** (`apps/web/src/server/llm`): turns text into data that must pass a
  caller-supplied Zod schema. It never executes code or application commands. When no provider
  is configured it is disabled, and every workflow still works through manual controls.

## Storage

The private buckets are `snapshots` (native documents), `previews` (PNG, JPEG, WebP) and
`references` (PNG, JPEG, WebP). Phase 1 policies are owner-only: object paths must start with
`<auth.uid()>/`. There is no update policy, so stored artifacts are write-once. Phase 3
replaces these with project-membership policies.

## Key decisions

- **Next.js 16 conventions.** Middleware is now `src/proxy.ts`, and it only refreshes the
  Supabase session. Authorization belongs in route handlers and RLS, not the proxy.
  `cacheComponents` is enabled, so dynamic handlers call `connection()`.
- **Python locking.** `uv` isn't installed, so the vision service uses `venv` + `pip-tools`
  with hash-locked `requirements*.lock` files.
- **No speculative connectors.** Only Photoshop is scaffolded.
