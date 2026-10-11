# Setup

## Prerequisites

| Tool               | Version used in Phase 1    | Notes                                         |
| ------------------ | -------------------------- | --------------------------------------------- |
| Node.js            | 24.2.0 (>= 20.9 required)  |                                               |
| pnpm               | 10.12.4                    | Pinned via `packageManager` in `package.json` |
| Python             | 3.12 (3.12–3.13 supported) | Vision service                                |
| Supabase CLI       | 2.75.0                     | Migrations and local stack                    |
| Docker Desktop     | 29.1.3                     | Only needed for the local Supabase stack      |
| Adobe Photoshop    | 2026 (27.8.0)              | Target version for the connector              |
| UXP Developer Tool | not yet installed          | Install from the Creative Cloud desktop app   |

## 1. JavaScript workspace

```sh
pnpm install
```

Workspace packages: `apps/web`, `connectors/photoshop` (and `packages/*` once added).

## 2. Vision service

```sh
cd services/vision
python3.12 -m venv .venv
.venv/bin/pip install pip-tools
.venv/bin/pip-sync requirements-dev.lock     # or requirements.lock for runtime only
.venv/bin/pip install --no-deps -e .
cp .env.example .env                          # set VISION_SERVICE_TOKEN
```

Dependencies are declared in `pyproject.toml` and locked with hashes. To change them, edit
`pyproject.toml`, then regenerate both lockfiles:

```sh
.venv/bin/pip-compile --generate-hashes --strip-extras -o requirements.lock pyproject.toml
.venv/bin/pip-compile --generate-hashes --strip-extras --extra dev -o requirements-dev.lock pyproject.toml
```

## 3. Environment

```sh
cp apps/web/.env.example apps/web/.env.local
cp services/vision/.env.example services/vision/.env
openssl rand -hex 32     # use the same value for VISION_SERVICE_TOKEN in both files
```

| Variable                               | Where        | Purpose                                                |
| -------------------------------------- | ------------ | ------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | web          | Supabase API URL                                       |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web          | Browser-safe key; RLS enforces access                  |
| `SUPABASE_SECRET_KEY`                  | web (server) | Admin key. Server-only; never in the browser or plugin |
| `VISION_SERVICE_URL`                   | web          | Default `http://127.0.0.1:8000`                        |
| `VISION_SERVICE_TOKEN`                 | web + vision | Shared bearer secret, at least 16 characters           |
| `VISION_MAX_UPLOAD_BYTES`              | vision       | Request body limit, default 20 MiB                     |
| `VISION_MAX_IMAGE_PIXELS`              | vision       | Decoded image limit, default 50 MP                     |
| `LLM_PROVIDER`                         | web (server) | `none` (default) or `anthropic`                        |
| `LLM_MODEL`                            | web (server) | Model id for the selected provider                     |
| `ANTHROPIC_API_KEY`                    | web (server) | Required when `LLM_PROVIDER=anthropic`                 |

All `.env*` files except `*.env.example` are git-ignored.

## 4. Supabase

### Hosted project (designated project)

Designated project: **Sonder** (ref `rihciqpkzdzpdsxmyaut`, East US). To connect a fresh checkout:

```sh
supabase login
supabase link --project-ref <project-ref>
supabase db push                       # applies supabase/migrations
```

Then, in the dashboard:

- **Project Settings → API Keys**: copy the URL, publishable key and secret key into
  `apps/web/.env.local`.
- **Authentication → URL Configuration**: set Site URL to `http://localhost:3000` and add
  `http://localhost:3000/auth/callback` to the redirect allow-list.
- **Storage → Settings**: the global upload limit on the free plan is 50 MB. The `snapshots`
  bucket is capped at 50 MiB to match. Raising it requires a paid plan; ask before changing it.

### Local stack (Docker)

```sh
supabase start -x studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor,mailpit
supabase status          # prints the local URL and keys for .env.local
supabase db reset        # re-applies all migrations
supabase stop
```

Local auth settings (site URL, callback allow-list) live in `supabase/config.toml`.

### Verify

```sh
pnpm --filter web verify:supabase
```

This checks bucket privacy, then creates a temporary user, uploads and downloads a private
file, and confirms that anonymous and cross-user access are denied. It deletes the user and the
file at the end.

## 5. Photoshop connector

1. Install **UXP Developer Tool** from the Creative Cloud desktop app (Apps → Categories →
   Developer tools).
2. In **Photoshop 2026**: Settings → Plugins → check **Enable Developer Mode**, click OK, then
   quit and restart Photoshop. This is required even when the UXP Developer Tool has enabled
   its own developer mode. Without it, Photoshop rejects every plugin with
   `Plugin rejected - <id> due to invalid object` in
   `~/Library/Logs/Adobe/Adobe Photoshop 2026/UXPLogs_*.log`, and the tool only reports
   "Plugin Load Failed". If other Photoshop versions are installed, make sure 2026 is the one
   running; each version has its own setting.
3. Start the web app (`pnpm dev`) so the panel's backend check can succeed.
4. In UXP Developer Tool: **Add Plugin** → select `connectors/photoshop/plugin/manifest.json`
   → **Load**.
5. Open a document, then open the **Sonder** panel from the menu bar: Plugins → Sonder → Sonder. It shows the Photoshop version, the active
   document name, and whether `http://localhost:3000/api/health` is reachable.

## 6. Start everything

```sh
# terminal 1 — vision service
cd services/vision && .venv/bin/uvicorn sonder_vision.main:app --app-dir src --host 127.0.0.1 --port 8000

# terminal 2 — web app
pnpm dev                                 # http://localhost:3000

curl localhost:3000/api/health           # web + vision + supabase + llm status
```

## 7. Checks

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check

cd services/vision
.venv/bin/pytest && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy src
```
