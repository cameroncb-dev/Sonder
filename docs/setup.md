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
pnpm --filter web verify:supabase      # hosted or local, per apps/web/.env.local
pnpm --filter web test:integration     # database tests; local stack only (refuses other URLs)
```

The hosted project grants API roles nothing by default. Every new table or function needs
explicit `grant` statements in its migration (see `20261011000400_table_grants.sql`). The
migrations revoke the local stack's broader defaults, so missing grants fail locally too.

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
3. Build the plugin. It's TypeScript bundled with esbuild into `plugin/dist/panel.js`, which
   git ignores:

   ```sh
   pnpm --filter @sonder/connector-photoshop build    # or `watch` while developing
   ```

4. Start the web app (`pnpm dev`) so the panel's backend check can succeed.
5. In UXP Developer Tool: **Add Plugin** → select `connectors/photoshop/plugin/manifest.json`
   → **Load & Watch**. With watch on, every rebuild reloads the plugin in Photoshop.
6. Open the **Sonder** panel from the menu bar: Plugins → Sonder → Sonder. It shows the
   Photoshop version, the active document, and whether `http://localhost:3000/api/health` is
   reachable. **Read document** lists supported layers and their properties.

### Connecting the plugin to Sonder

1. Sign in at `http://localhost:3000/login`.
2. In the Sonder panel, click **Connect**. It shows a code such as `ABCD-2345`.
3. Open `http://localhost:3000/pair`, enter the code, and click **Approve**. The panel switches to
   "Connected as …". The token lasts 12 hours, then you connect again.
4. Save your document, choose a project in the panel, and click **Link active document**.
5. Jobs for linked documents run while the panel is open.

### Using the canvas

1. Open `http://localhost:3000/projects`, create a project, and open it.
2. Link a saved document from the Photoshop panel. Its card appears on the canvas.
3. Click the card to open the inspector:
   - **Capture** saves a checkpoint onto the active branch.
   - **Branch from here** on any checkpoint creates a branch.
   - **Switch** opens a branch head in Photoshop as a working copy.
   - Tick two checkpoints and click **Compare**.
4. **Add note** and **Add reference** place cards. Drag cards to arrange them, and drag
   between card handles to connect them. Connections never change version history.

End-to-end check (dev server running, panel open with Load & Watch):

```sh
pnpm --filter web e2e:connector
```

### Feasibility suite (real Photoshop checks)

Click **Run feasibility suite** in the panel, or trigger it from a terminal while the panel is
open:

```sh
DATA="$HOME/Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/Developer/com.sonder.photoshop/PluginData"
echo "{\"runId\":\"r$(date +%s)\"}" > "$DATA/dev/trigger.json"
cat "$DATA/feasibility/latest-report.json"     # written when the run finishes
```

Each run creates its own documents in Photoshop, closes them without saving, and writes every
artifact (fixture, snapshots, previews, manifests, report) to
`$DATA/feasibility/run-<runId>/`. Documents you already have open are not touched.

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
