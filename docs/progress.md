# Progress

## Phase 6 — Shared Themes, Project Directions and Canvas Additions

Status: **in progress.** Branch: `phase-6-themes-canvas`.

Scope (from `Design_Plan.md` §15, plus canvas additions the user requested on 2026-10-11):

1. **Canvas additions (first, then a check-in with the user):**
   - styled notes (shape, color, font chosen before placing);
   - free text anywhere;
   - resizable sections that carry their cards;
   - a font picker (system fonts plus about 50 Google Fonts, loaded on demand).
2. **Shared themes:** primary, background, text and accent color roles; explicit role-to-layer
   mappings per asset; per-asset candidates and previews; inclusion and exclusion; approval
   of the collection; per-asset status; visible partial failures.
3. **Directions:** named collections of exact checkpoints that stay stable as branches move.

### Part 1 — canvas additions: built, awaiting the user's check

- **Left toolbox** (`toolbox.tsx`) with collapsible Notes, Text, Sections and References
  panels, toggled by a waffle button in the header. Visibility, open panels and chosen styles
  are remembered per browser. **Add note** and **Add reference** moved here from the header.
- **Place by clicking:** choose a style, click **Place …**, then click the canvas (crosshair
  cursor; Esc cancels). The new card's text takes focus.
- **Notes:** sticky, rounded, circle and diamond shapes; 7 colors; any font.
- **Text:** small, medium and heading sizes; 7 colors; any font; grows with its content.
- **Sections:** titled, tinted, resizable (corner handles), drawn beneath cards. Dragging a
  section carries the cards whose centre lies inside it. Deleting a section leaves its cards.
- **Restyle later:** a selected note, text or section shows a floating style bar.
- **Fonts:** 12 system fonts and 55 Google Fonts. The picker shows each name in its own
  typeface (one subset request). A font downloads in full only when used.
- **Saving:** every change carries the card's version (optimistic concurrency). Multi-card
  drags save every moved card.
- **Server:** migration `20261015000000_canvas_text_and_sections.sql` adds the `text` and
  `section` item types. The API validates content per type (shapes, colors, sizes, known
  fonts); old notes get default styles.
- **Checks:** unit 10/10 (content rules, all fonts), integration 35/35, E2E all passed (2
  new: styled cards round-trip; unknown fonts and shapes refused; section resize persists),
  typecheck, lint, build.
- **Not verified automatically:** how it looks in a browser, placement clicks, and sections
  carrying cards while dragged (client-side logic). These are for the user's check.

Notes:

- Google Fonts are fetched from Google's servers by each viewer's browser when a font is
  first shown. System fonts need no download.

## Phase 5 — Selective Combination and Approval

Status: **complete, pending your interactive test.** Every acceptance criterion is verified end
to end against the hosted project with the real plugin. The combine screen has been
build-checked but not yet used in a browser. Branch: `phase-5-combine`.

### Completed

| Task                                  | Result                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge engine                          | `packages/connector-sdk/src/merge.ts`: three-way, per property, against the shared ancestor; no application assumptions                     |
| Bind proposals to exact checkpoints   | Each proposal records base, target and source checkpoint ids, the target branch, every choice and the change set                            |
| Validate supported objects/properties | Engine: connector-declared property types and element editability. Plugin: the change set's shape, then layers and fonts in the document    |
| Separate editable candidate           | A `createCandidate` job applies the change set to a copy of the target snapshot (never the open document) and verifies Photoshop applied it |
| Candidate preview                     | Captured with the candidate; the review screen shows target, candidate and source side by side                                              |
| Record approval of exact candidate    | `approve_proposal` requires the candidate id that was shown and records approver, time, and native and preview digests                      |
| Finalize as a new checkpoint          | Approval advances the target branch to the candidate (compare-and-swap); its parents are both branch heads                                  |
| Preserve source checkpoints           | Sources are only read; candidates of unapproved proposals stay out of history                                                               |
| Handle unsaved work                   | Building never touches the open document. "Open result" reuses the branch switch, which refuses on unsaved or uncaptured changes            |

**Merge rules**, applied per element (matched by connector-declared identity fields;
Photoshop: layer id) and per property:

- Neither side changed: keep the value.
- Only the source changed: take it by default; can be excluded.
- Only the target changed, or both changed identically: already in the target.
- Both changed differently: a conflict. A candidate can't be made until it's resolved.

When the branches have no single shared ancestor, the user must choose a baseline. Layers
added or removed on either side are listed but never combined; the result keeps the
target's layers.

**Permissions:** owners and editors can propose, approve and discard. Reviewers can view.
(This was my call; it is easy to change.)

### Files and migrations

- Migration `20261014000000_combination_proposals.sql`:
  - `checkpoints.proposal_item_id`;
  - `create_combination_proposal` (proposal, item and job in one transaction);
  - `begin_checkpoint`: candidate parents come from the job, never the plugin;
  - `finalize_checkpoint`: candidates never move branches;
  - `track_candidate_job` trigger;
  - `approve_proposal` and `reject_proposal`.
- Contracts: `ConnectorManifest.identityFields`. Photoshop connector version 0.3.0 declares
  `["layerId"]`.
- API: `assets/:id/combine` (preview), `assets/:id/proposals` (list, create),
  `proposals/:id/approve`, `proposals/:id/reject`. The database error `55000` maps to
  409 `STALE`.
- UI: `combine-view.tsx` (choose branches, a property table with per-row choices and
  conflicts, review of three previews, approve/discard, open result) and a "Combine"
  section in the inspector.
- Plugin: the `createCandidate` job handler; a shared upload path for captures and
  candidates; per-file **baselines** (see Problems found); dev actions `set-property` and
  `fonts`.

### Verification performed (actual results)

| Check                                                     | Result                                                                                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`, `lint`, `test`, `format:check`, `build` | Pass. Merge engine unit tests: 13 new (SDK 20/20)                                                                                                                                                            |
| `test:integration` (local)                                | 33/33 (7 new: binding and job, reviewer/moved-branch/cross-asset refusal, candidate parents without moving branches, exact-candidate approval, finalize and record, stale approval and discard, failed jobs) |
| `e2e:connector` (hosted + Photoshop 27.8.0)               | **59/59** (16 new, listed below)                                                                                                                                                                             |

New end-to-end checks:

- Two branches were made from one checkpoint:
  - `background`: background fill to `#8B1E3F` and headline color to gold;
  - `alt`: headline font to Georgia and headline color to green.
- The comparison found the shared ancestor and classified font (target), fill (source) and
  headline color (conflict).
- The unresolved conflict was refused (422).
- With "keep alt's color", Photoshop built the candidate from a copy, and the proposal became
  ready.
- The candidate has alt's font, the background branch's fill and the chosen green. The
  headline text and size, and the whole body layer, equal the base.
- The candidate was hidden from history until approval. Approval made it alt's head, with
  both branch heads as parents.
- The stored native and preview files match the digests recorded at approval, and those
  match the reviewed candidate.
- All source checkpoints are byte-for-byte unchanged. A second approval returns 409.
- After approval, the open working copy isn't flagged as uncaptured. "Open result" opens the
  candidate without force and reports no changes.
- Combining the same branches again returns `NOTHING_TO_COMBINE`.

### Problems found and fixed during development

- **False "uncaptured changes" after approval:** both the uncaptured indicator and the
  branch-switch safety check compared the open file with the _branch head_. Approval moves
  the head ahead of the open working copy, so opening the result would have been refused.
  The plugin now records each file's **baseline** (the checkpoint it was opened from or last
  captured as) and compares against that, falling back to the head.
- **Unsafe foreign key:** an `on delete set null` from checkpoints to proposal items would
  have tried to update immutable finalized checkpoints when a proposal was deleted. Changed
  to a plain reference (project deletion removes both together).

### Also added during testing

- **Delete documents from the canvas.** Use "Delete from project" in the inspector, or select
  the card and press Delete. A popup confirms with a grey Cancel and a red Delete. Documents
  with history get the warning "This project card has some change history"; deleting
  removes branches, checkpoints, proposals and stored snapshot and preview files. The API
  refuses a document with checkpoints unless `?withHistory=true` is sent, which only the
  popup does. Owners and editors can delete. Covered by an integration test (cascade) and an
  E2E check (confirmation required).

- **Which file is Sonder tracking?** (Found in testing: an edit went into the original file
  while Sonder captured the branch working copy, so the "font" capture was identical to its
  parent. The original file had also been linked again as a duplicate document.)
  - Migration `20261014000100_asset_known_paths.sql`: `assets.known_paths` remembers every
    file a document has used, both the original and each working copy.
  - Working copies open as **"<document> - <branch>.psd"** (one folder per switch).
  - The panel shows "✓ Sonder tracks this file: <document> · branch <name>". On an earlier
    file it warns that edits won't be captured, names the tracked file, offers "Show the
    tracked file", and hides Link.
  - Linking an earlier file returns 409 `ALREADY_TRACKED` instead of creating a duplicate.
  - History marks captures whose text and colors equal the previous version: "No text or
    color changes".
  - The inspector explains Capture, Branches, Combine and History in one line each.
  - E2E: 5 new checks (working copy name, original recognised and not linkable, no-change flag
    on and off, delete confirmation). Integration: 35/35.

### Known limitations

- Only properties are combined. Added or removed layers, pixels and mixed-format text are
  preserved from the target but never merged.
  **Decision (2026-10-11): keep property-level combining for now.** A possible later
  improvement is whole-layer combining: treat any layer, pixel layers included, as a unit;
  take source-only changes and additions; resolve layers changed on both sides as conflicts.
  This needs a spike on Photoshop's pixel-reading and cross-document layer copy APIs first.
- A proposal combines two branches of **one** asset. Coordinated updates across assets are
  Phase 6.
- Each change of choices creates a new proposal and candidate; old ones remain listed (discard
  them).
- After approval the open working copy is behind its branch until "Open result". The card
  doesn't show "behind" yet.
- Files used before `known_paths` existed were backfilled from switch history. The user's
  original `Downloads/Sonder-Test.psd` was added by hand.

### Recommended next phase

Phase 6 (shared themes and project directions).

## Phase 4 — Canvas and Branching

Status: **complete.** All acceptance criteria are verified end to end against the hosted
project with the real plugin, and the canvas was tested interactively in a browser on
2026-10-11 (see Interactive testing). Branch: `phase-4-canvas`.

### Completed

| Task                               | Result                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Project dashboard                  | `/projects`: list and create projects                                                                                                     |
| Asset cards, references, notes     | `/projects/[id]`: React Flow canvas. Asset cards are placed automatically; notes are editable; reference images upload to private storage |
| Persist canvas positions           | Saved on drag stop; reloads restore them                                                                                                  |
| Checkpoint inspector               | Side panel per asset: capture, branches, history graph, checkpoint details (preview, document info, element properties)                   |
| Create branches from checkpoints   | "Branch from here" on any checkpoint; the source is never modified                                                                        |
| Display history relationships      | Commit-graph lanes drawn from `checkpoint_parents` only                                                                                   |
| Active branch and connector status | Card and inspector show the active branch, connector online/offline, and actions from the connector's capability manifest                 |
| Side-by-side comparison            | Pick two checkpoints, then previews side by side plus a property table with differences highlighted                                       |
| Optimistic concurrency             | Saves carry a `version`. A stale save gets 409 with the current item; the database trigger also rejects skipped versions                  |
| Unsaved / uncaptured indicator     | The plugin reports each open linked document's state; the card and inspector show "Unsaved changes" or "Saved changes not captured yet"   |

**Branching model:**

- Captures attach to the asset's active branch: the parent is the branch head, and the head
  advances by compare-and-swap.
- The first capture creates and activates `main`.
- Switching branches is an `openCheckpoint` job. The plugin opens the branch head as a
  Sonder-managed working copy, and the asset follows that copy. It refuses with
  `UNSAVED_CHANGES` or `UNCAPTURED_CHANGES`, unless forced. The original file is never
  overwritten.

### Files and migrations

- Migration `20261012000000_branching.sql`: `assets.active_branch_id` (composite foreign key to
  the asset's own branches), branch-aware `begin_checkpoint` and `finalize_checkpoint`, the
  `apply_checkout` trigger, and the canvas version trigger.
- API: `canvas`, `canvas/items[/:id]`, `canvas/connections[/:id]`,
  `assets/:id/{history,branches,capture,checkout}`, and `connector/checkpoints/:id/download`.
- UI: `src/app/projects/**`, `src/components/canvas/*` (nodes, inspector, history graph,
  compare view, canvas), and `src/lib/api-client.ts`.
- Plugin: the `openCheckpoint` (checkout) operation, snapshot download, and dev actions
  `edit-text` and `save-active`.
- Contracts: new issue codes `UNSAVED_CHANGES` and `UNCAPTURED_CHANGES`.
- Migration `20261013000000_unique_asset_links.sql`: one asset per document path per project, and
  one canvas card per asset.
- Migration `20261013000100_session_document_state.sql`: `session_assets.unsaved` and
  `uncaptured`, and `report_session_documents`, which also returns each asset's branch head.
  `report_session_assets` remains for older connectors.
- API: `connector/checkpoints/:id/elements`, so the plugin can compare an open document with its
  branch head.

### Verification performed (actual results)

| Check                                                                   | Result                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `lint`, `test`, `format:check`, web `build`           | Pass                                                                                                                                                                                                                                        |
| `test:integration` (local)                                              | 26/26 (10 new: main creation, parent links, branching keeps sources, compare-and-swap, checkout switching, cross-asset rejection, canvas version conflicts, connections vs ancestry, unique asset links and cards, reported document state) |
| `e2e:connector` (hosted + Photoshop 27.8.0)                             | **43/43** (19 new, listed below)                                                                                                                                                                                                            |
| Page smoke test (`/`, `/projects`, `/projects/[id]`, `/login`, `/pair`) | 200 on each                                                                                                                                                                                                                                 |

New end-to-end checks:

- The first capture created and activated `main`, and the second advanced it (its parent is
  the first). A branch `alt` was created from the first checkpoint.
- Checkout refused an unsaved document (`UNSAVED_CHANGES`) and then a saved but uncaptured one
  (`UNCAPTURED_CHANGES`). `main` stayed active.
- A forced checkout opened `alt` as a working copy, the asset path followed it, and the
  heartbeat mapped it.
- A capture on `alt` descends from the first checkpoint. `main`'s head is unchanged, and both
  source checkpoints are intact (the digest matches the original).
- History shows three checkpoints with previews.
- The canvas auto-placed the asset card and shows application, active branch (`alt`), online
  status and all eight connector operations.
- A stale save got 409 with the current position, and the layout persisted after reload.
- Connecting and moving cards left `checkpoint_parents` unchanged.
- A reviewer can read history but gets 403 for moving cards and for capture.
- The canvas reports a captured document as up to date, then "unsaved" after an edit, then
  "uncaptured" after saving.

### Problems found and fixed during verification

- **Canvas conflict error code:** it originally used `40001`, which PostgREST retries forever.
  Switched to `23514`.
- **Variable name clash:** in `finalize_checkpoint`, the local `result` collided with
  `jobs.result`.
- **Build:** `useParams()` needed a `<Suspense>` boundary under Cache Components.
- **React lint rules:** state was being set synchronously inside effects. Restructured to
  effects keyed on reload counters, with cancellation.

### Interactive testing (2026-10-11)

The user tested the canvas in Chrome with Photoshop 2026 against the hosted project. Every check
passed after the fixes below:

- Sign up, create a project, add notes and reference images.
- Pair the panel, link two documents, capture.
- Compare two checkpoints.
- Branch from an earlier checkpoint, then switch branches in both directions.
- Both switch refusals (unsaved, uncaptured), then **Switch anyway**.
- Capture on a branch, with history splitting into two lines.
- Connect and delete cards; positions persist across reloads.

Problems found and fixed:

- **Duplicate assets:** concurrent link requests created three copies of one document, after
  which every link returned 500. Fixed with a unique index, an on-conflict return of the existing
  asset, and a guarded panel button.
- **Project selection in the panel:** UXP's `<select>` reported an empty value while showing
  the first project, so Link stopped at "Choose a project first" and the button never showed
  Linked. The panel now tracks the selection itself. The button reads "Linked" for documents
  already linked to the selected project.
- **Cards out of view:** new document cards were placed on a fixed grid far from existing
  content, and cards linked while the canvas was open didn't appear until a full reload. Cards
  are now placed beside existing content, the view fits all cards on open and when a new
  document appears, and the periodic refresh picks up new cards.
- **Notes stacking:** repeated "Add note" placed notes exactly on top of each other. New cards
  are now offset.
- **Compare view:** the table listed added layers as rows of dashes, labelled the columns
  Left/Right, and depended on selection order. React also warned about duplicate keys when two
  layers shared a name. Compare now shows Before/After by date with checkpoint names, a summary,
  rows grouped by layer with added/removed/changed badges and renames, and layer-ID keys.
- **Repeated job clicks:** a triple click on Switch anyway queued three checkouts and opened
  three working copies. Capture and switch buttons are now disabled while a job is pending.
- **Dark mode:** the controls and minimap stayed light. The canvas now follows the system theme,
  read without a hydration mismatch.
- **Messages:** failure messages showed internal codes, and a stale "Capture queued" message
  stayed visible after the capture finished. Both fixed.
- **Connection handles** were hard to find. They are now larger, blue, and grow on hover.
- **E2E cleanup** closed every Sonder working copy without saving, including the user's. It now
  closes only the documents the test created.

### Known limitations

- **The original file isn't recognised after switching branches.** Switching opens a working
  copy, and the asset then follows that copy. Reopening the original file (for example
  `Downloads/Sonder-Test.psd`) shows it as unlinked in the panel, and linking it would create a
  second, unrelated asset. **Decision needed:** for example, keep every path that belongs to an
  asset and have the panel offer to switch to the branch.
- Plugins loaded through UXP Developer Tool must be reloaded after Photoshop restarts, and Load &
  Watch sometimes misses rebuilds (Unload, then Load & Watch, fixes it).
- Document state on the card refreshes with the canvas (about every 15 s), not instantly.
- Working copies live in the plugin's data folder (`…/PluginData/connector/working/`), not next
  to the original PSD.
- History is a flat list per asset with lanes. Merges (multiple parents) are drawn but can't be
  created until Phase 5.
- Live multiplayer editing is deferred. Concurrent edits are handled by version conflicts only.
- Reference images are not yet analyzed (Phase 7).

### Recommended next phase

Phase 5 (selective combination and approval).

## Phase 3 — Persistence, Permissions, and Jobs

Status: **complete.** All acceptance criteria are verified against the hosted Supabase project
with the real Photoshop plugin. Branch: `phase-3-persistence`.

### Completed

| Task                                   | Result                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Data model and migrations              | All design entities plus `asset_elements`, `session_assets`, `job_events`, `canvas_connections`                        |
| Owner, editor, reviewer permissions    | `project_role` enum; `has_project_role` / `is_project_member` / `can_edit_project` helpers                             |
| Backend authorization                  | Every user route calls `requireUser` + `requireProjectRole`; connector routes call `requireConnectorSession`           |
| Database and storage policies          | RLS on every table; storage access by project membership; snapshots and previews are written only by the backend       |
| Pair connector sessions with users     | Device-code flow: plugin shows a code, a signed-in user approves it at `/pair`, the plugin polls for its token         |
| Expiring connector credentials         | Random 32-byte tokens, stored as SHA-256, 12 h lifetime; pairing codes expire in 10 min; the poll secret is single-use |
| Plugin polling while the panel is open | Heartbeat (open documents) and claim every 3 s                                                                         |
| Route jobs to sessions and assets      | `claim_job`: same application, declared operation, user can edit, and (by default) the asset's document is open there  |

Job requirements:

- **Unique operation ids:** `jobs.operation_id` and `checkpoints.operation_id` are unique, and `create_job` is idempotent.
- **Explicit transitions:** enforced by a trigger, with every change logged in `job_events`.
- **Leases:** 120 s.
- **Bounded retries:** `max_attempts` 1–10, default 3.
- **Stored results:** `jobs.result` and `jobs.error`.
- **Reconciliation:** expired leases are checked for a finalized checkpoint with the job's operation id
  before re-queueing. The plugin also keeps a local ledger and reuses its first capture on retry.

### Files and migrations

- Migrations: `20261011000000_core_data_model.sql`, `…000100_jobs_and_connectors.sql`,
  `…000200_project_storage_policies.sql`, `…000300_function_grants.sql`, `…000400_table_grants.sql`.
- `packages/contracts/src/api.ts`: connector ↔ backend request and response schemas.
- `apps/web/src/server/` (`http.ts`, `auth.ts`, `connector-auth.ts`) and the routes under
  `src/app/api/{projects,jobs,connector}`; pages `/login` and `/pair`.
- `apps/web/tests/integration/` (Vitest, local stack only), `scripts/e2e-connector.mts`, and the
  updated `scripts/verify-supabase.mts`.
- `connectors/photoshop/src/sync/` (API client, runtime, ledger, store), `src/dev/actions.ts`,
  and connection UI in the panel.

### Verification performed (actual results)

| Check                                                         | Result                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint`, `pnpm test`, `format:check`    | Pass (24 unit tests)                                                                                                                                                                                                          |
| `pnpm --filter web build`                                     | Pass                                                                                                                                                                                                                          |
| `pnpm --filter web test:integration` (local stack)            | 16/16: role permissions, hidden session secrets, routing, duplicate delivery, pending checkpoints hidden, digest mismatch, lease retries, reconciliation, invalid transitions, expired sessions, history constraints, storage |
| `pnpm --filter web verify:supabase` (hosted)                  | 15/15                                                                                                                                                                                                                         |
| `pnpm --filter web e2e:connector` (hosted + Photoshop 27.8.0) | **24/24**, listed below                                                                                                                                                                                                       |

End-to-end checks, using the real plugin and the real API routes:

- Pairing: a code was shown, an unknown code was rejected, approval worked, and the token is
  bound to the user and expires. Pairing secrets were cleared.
- The plugin linked an open document, and the heartbeat mapped it to the asset.
- A capture job ran claim → capture → upload → finalize. The stored snapshot and preview match
  their manifest digests (198,180-byte PSD). Resubmitting the operation id returned the same job
  and no new checkpoint.
- Interrupted delivery: a fault was injected before finalize and the lease was expired.
  Result: transitions `queued leased queued leased succeeded`, attempt 2, the retry reused the
  first capture and uploaded 0 files, and exactly one checkpoint exists. The pending checkpoint
  stayed hidden until finalized.
- A job for a document that isn't open stayed queued, with 0 attempts.
- An outsider got 404 on listing, job creation and job reads, and couldn't download the
  snapshot. A fake token got 401, and direct `claim_job` RPC calls got `42501`.
- When the token expired, the plugin stopped and asked to pair again.

### Problems found and fixed during verification

- **Hosted grants:** the hosted project grants no table or function privileges to API roles by
  default, unlike the local CLI stack. Fixed with the explicit grant migrations, which also revoke
  the local defaults so local tests now match hosted behavior.
- **Local stack versions:** `supabase link` pinned the hosted service versions, which CLI 2.75
  could not run. Upgraded the Supabase CLI to 2.120.0.
- **Audit log trigger:** it was inserting before the job row existed. Split into before
  (validate) and after (log) triggers.
- **Route wrapper:** it swallowed Next's prerender bailout. It now calls `connection()` first.
- **E2E fixture:** overwriting an open PSD triggered a Photoshop dialog. Each run now uses a new
  file, and the run closes its documents at the end.

### Known limitations

- Stored-file integrity is checked with FNV-1a 64 against the manifest. This detects corruption,
  not tampering by a paired client.
- `/api/connector/pair/start` is unauthenticated and not rate limited. Pending sessions expire
  after 10 minutes but are not purged.
- Uploads pass through the Next.js backend (50 MiB snapshot limit) so it can verify digests
  before storing.
- Assets are matched to documents by file path, so moving or renaming a PSD breaks the link
  until it is relinked.
- Member management looks users up by email across at most 4,000 accounts (paged admin API).
- Jobs only run while the panel is open. There is no push delivery.
- Proposals and canvas tables exist but have no API yet (Phases 4–5).

### Blockers requiring user input

None.

### Recommended next phase

Phase 4 (canvas and branching).

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
