# Sonder — Development Design and Execution Plan

## 1. Instructions for Claude Code

You are building **Sonder**, a collaborative visual workspace for creative projects across multiple applications.

Implement the project in the phases below.

**Start with Phase 1 only. Complete its available tasks, verify the results, and report blockers before proceeding.**

Before changing code:

- Inspect the repository and existing project instructions.
- Preserve existing work and reuse suitable configuration.
- Consult current official documentation for dependencies and application APIs.
- Install compatible stable versions and commit dependency lockfiles.
- Never invent credentials or report unverified integrations as working.
- When external access is unavailable, complete independent tasks and document the blocker.
- Keep implementation scoped to the current phase.
- Ask before introducing major architectural changes.

## 2. Product Vision

Sonder is a collaborative visual workspace where teams organize creative assets, explore alternative directions, compare versions, and combine selected changes into editable results.

Its main interface is a FigJam-style canvas containing:

- Connected creative documents.
- Reference images.
- Notes and discussions.
- Checkpoints and branches.
- Shared color themes.
- Named creative directions.
- Change proposals and approvals.

Sonder's long-term scope includes:

- Adobe Photoshop.
- Adobe Illustrator.
- Adobe Premiere Pro.
- Adobe After Effects.
- DaVinci Resolve.
- Other creative applications through additional connectors.

Each application requires its own integration and supported operations.

Official inclusion in Adobe Creative Cloud is a long-term aspiration, not an existing partnership or implementation dependency.

## 3. Demo Scope vs. Product Scope

**The architecture supports multiple creative applications. The demo implements Photoshop only.**

The demo must work with two Photoshop documents and demonstrate:

1. Saving recoverable checkpoints.
2. Creating alternative branches.
3. Comparing versions.
4. Combining selected changes.
5. Extracting a palette from a reference.
6. Applying a shared theme across two documents.
7. Previewing and approving results.
8. Saving a named creative direction.
9. Reopening earlier checkpoints.

Do not hardcode Photoshop assumptions into shared project, history, canvas, review, or job models.

Do not build speculative connectors for other applications during the demo.

## 4. Initial Editing Capabilities

The Photoshop connector initially supports:

- Uniform text content.
- Font family.
- Font size.
- Text color.
- Color of a designated solid-color background layer.

Users assign roles such as:

- `headline`
- `body_text`
- `background`

Validate role-to-layer mappings before operations.

Preserve unsupported content through complete PSD snapshots.

Exclude from the demo:

- Arbitrary pixel-edit merging.
- Mixed formatting within a single text layer.
- Automatic matching of deleted and recreated layers.
- Simultaneous editing inside Photoshop.
- Automatic capture of every editing action.

## 5. Technology Stack

| Component | Technology | Responsibility |
|---|---|---|
| Web application | Next.js, React, TypeScript | Dashboard, canvas, comparisons, themes, reviews |
| Styling | Tailwind CSS | Components and layouts |
| Canvas | React Flow | Movable cards and visual connections |
| Application API | Next.js API routes | Permissions, proposals, operations, jobs |
| Database | Supabase PostgreSQL | Projects, assets, history, themes, approvals |
| Authentication | Supabase Auth | Accounts and membership |
| File storage | Supabase Storage | Snapshots, previews, references |
| Demo connector | Photoshop UXP plugin | Capture and modify Photoshop documents |
| Computer vision | Python, FastAPI, OpenCV, NumPy | Palette extraction and visual differences |
| Language interpretation | Server-side LLM adapter | Convert text into constrained proposals |
| Validation | Zod and Pydantic | Validate contracts and service requests |
| Testing | Vitest, pytest, integration checks | Verify logic and actual document behavior |

Use:

- pnpm workspaces for JavaScript packages.
- An isolated Python environment with locked dependencies.
- Server-side credentials for external AI services.
- Private storage for user artifacts.

ElevenLabs and spoken interaction are deferred.

## 6. Repository Structure

    apps/
      web/

    connectors/
      photoshop/

    services/
      vision/

    packages/
      contracts/
      connector-sdk/
      merge-engine/

    supabase/
      migrations/

    docs/
      architecture.md
      connector-contract.md
      setup.md
      progress.md
      acceptance-tests.md

Do not create empty implementations for every future application.

Keep shared packages free of Node.js or browser assumptions that would break Photoshop's UXP runtime.

## 7. System Architecture

### Web application

Handles:

- Projects and membership.
- Canvas presentation.
- Branch navigation.
- Comparison.
- Theme editing.
- Proposals and approvals.

### Backend

Handles:

- Authorization.
- Data validation.
- Checkpoint metadata.
- Proposal orchestration.
- Connector jobs.
- Vision service requests.
- LLM requests.

### Application connectors

Handle:

- Reading supported application data.
- Capturing native snapshots.
- Creating editable candidates.
- Exporting previews.
- Opening saved checkpoints.
- Reporting execution results.

### Vision service

Handles:

- Palette extraction.
- Visual difference analysis.

### LLM adapter

Translates user requests into schema-validated proposals.

It must never execute arbitrary code or application commands.

## 8. Connector Contract

Each connector declares:

- Application identifier.
- Connector version.
- Supported asset types.
- Supported operations.
- Supported property types.
- Preview formats.
- Runtime requirements.
- Known limitations.

Potential operations:

| Operation | Purpose |
|---|---|
| Discover assets | Identify available documents or projects |
| Capture checkpoint | Save a native snapshot, preview, and manifest |
| Read properties | Inspect supported editable elements |
| Validate proposal | Check objects, resources, and operations |
| Create candidate | Apply changes to a separate editable copy |
| Generate preview | Render a candidate |
| Open checkpoint | Reopen a saved version safely |
| Report status | Report connection and execution state |

Not every connector must implement every operation.

The UI must use capability declarations to enable or disable actions.

Do not model every application as Photoshop layers.

Use:

- Stable Sonder element identifiers.
- Typed properties.
- Connector-specific metadata.
- Validated mappings to native application objects.

A vector connector may work with paths and text objects.

A video connector may work with clips, timelines, and grading parameters.

### Distinct operation categories

1. **Branch combination**
   - Combines supported changes from versions of the same asset.

2. **Coordinated update**
   - Applies a shared theme across assets through their connectors.

3. **Asset transfer**
   - Moves or places content between applications.

Generic cross-format merging and asset transfer are outside the demo.

## 9. Data Model

| Entity | Purpose |
|---|---|
| Project | Shared canvas, members, assets, discussions |
| Project member | Access and approval permissions |
| Asset | Connected document with application type |
| Connector session | Authenticated application connection |
| Checkpoint | Immutable snapshot, preview, manifest, authorship |
| Checkpoint relationship | Parent links and combination ancestry |
| Branch | Named path pointing to its latest checkpoint |
| Canvas item | Position and presentation of an item |
| Theme | Named semantic color roles |
| Theme mapping | Role-to-asset-property mapping |
| Direction | Collection of exact asset checkpoints |
| Proposal | Requested changes, sources, candidates, approval |
| Proposal item | Per-asset operation and outcome |
| Job | Connector or analysis task |
| Comment | Feedback attached to a relevant object |

### Data constraints

- Finalized checkpoint contents are immutable.
- Each checkpoint belongs to one asset.
- Branches reference checkpoints from their own asset.
- Combined checkpoints can have multiple parents.
- Direction entries reference exact checkpoints.
- Incomplete snapshots cannot appear as recoverable checkpoints.
- Canvas connections do not determine version ancestry.
- A saved direction must remain stable when branches advance.

## 10. Phase 1 — Collect Components and Configure Services

### Goal

Assemble and verify the development environment before building product features.

### Repository and packages

- [ ] Inspect existing code and available runtimes.
- [ ] Initialize the workspace where needed.
- [ ] Scaffold Next.js with TypeScript and Tailwind.
- [ ] Install React Flow.
- [ ] Install Supabase clients.
- [ ] Install Zod and Vitest.
- [ ] Create the Python environment.
- [ ] Install FastAPI and an ASGI server.
- [ ] Install OpenCV headless, NumPy, Pydantic, and pytest.
- [ ] Configure formatting, linting, type checking, and tests.
- [ ] Add environment examples and secret exclusions.

### Supabase

- [ ] Identify the designated Supabase project.
- [ ] Connect to it or document required user setup.
- [ ] Initialize migration tooling.
- [ ] Configure development authentication and callbacks.
- [ ] Create private snapshot, preview, and reference buckets.
- [ ] Configure authenticated access policies.
- [ ] Verify database connectivity.
- [ ] Verify authenticated private upload and download.
- [ ] Keep administrative credentials server-side.

Do not modify unrelated projects or provision paid resources without authorization.

### Photoshop

- [ ] Check local Photoshop availability.
- [ ] Check UXP development tooling.
- [ ] Record the target Photoshop version.
- [ ] Scaffold a minimal plugin and manifest.
- [ ] Configure required permissions.
- [ ] Verify plugin loading.
- [ ] Read the active document's name.

If Photoshop cannot run in the development environment:

- Provide local setup instructions.
- Mark runtime verification as pending.
- Continue independent setup work.

### Service connectivity

- [ ] Add web backend and vision health endpoints.
- [ ] Verify backend-to-vision communication.
- [ ] Configure vision service authentication.
- [ ] Set upload size limits.
- [ ] Document connector communication configuration.

### LLM adapter setup

- [ ] Define a provider-independent interface.
- [ ] Document required environment variables.
- [ ] Configure a provider only if credentials are supplied.
- [ ] Disable language interpretation when unconfigured.

### Documentation

Create:

- `docs/setup.md`
- `docs/architecture.md`
- `docs/connector-contract.md`
- `docs/progress.md`

### Acceptance criteria

- Web and vision services start.
- Dependencies resolve.
- Type checks pass.
- Supabase access is verified or explicitly blocked.
- Plugin scaffolding exists.
- Plugin runtime verification status is accurate.
- No secrets are committed.
- Startup commands are documented.

**Stop and report Phase 1 results before continuing.**

## 11. Phase 2 — Connector Contract and Photoshop Feasibility

### Goal

Prove the shared connector contract through real Photoshop operations.

### Tasks

- [ ] Create a test PSD with text and a solid-color background.
- [ ] Implement capability reporting.
- [ ] Discover supported layers.
- [ ] Assign and validate element roles.
- [ ] Read supported properties.
- [ ] Change a headline font.
- [ ] Change the background color.
- [ ] Create an editable copy without overwriting the source.
- [ ] Export a preview.
- [ ] Save and reopen a native snapshot.

Capture the snapshot, preview, and manifest from the same document state.

### Acceptance criteria

- Operations use the connector contract.
- Sources remain intact.
- Candidate copies remain editable.
- Reopened snapshots preserve expected content.
- Missing fonts and layers produce explicit errors.
- Operations are verified in the documented Photoshop version.

Simulated operations do not satisfy this phase.

## 12. Phase 3 — Persistence, Permissions, and Jobs

### Goal

Store real creative history and coordinate execution.

### Tasks

- [ ] Implement the data model and migrations.
- [ ] Add owner, editor, and reviewer permissions.
- [ ] Enforce backend authorization.
- [ ] Enforce database and storage policies.
- [ ] Pair connector sessions with authenticated users.
- [ ] Use expiring connector credentials.
- [ ] Implement plugin polling while the panel is open.
- [ ] Route jobs to compatible sessions and intended assets.

### Job requirements

- Unique operation identifiers.
- Explicit status transitions.
- Job leases.
- Bounded retries.
- Stored results.
- Reconciliation before retrying uncertain operations.

Never embed administrative credentials in a plugin.

### Acceptance criteria

- Unauthorized users cannot access project data or artifacts.
- Repeated delivery does not duplicate edits or checkpoints.
- Incomplete snapshots remain unavailable.
- Jobs reach the correct connector and asset.

## 13. Phase 4 — Canvas and Branching

### Goal

Make creative work visible and navigable.

### Tasks

- [ ] Build the project dashboard.
- [ ] Add asset cards, references, and notes.
- [ ] Persist canvas positions.
- [ ] Build the checkpoint inspector.
- [ ] Create branches from selected checkpoints.
- [ ] Display history relationships.
- [ ] Show active branch and connector status.
- [ ] Add side-by-side preview comparison.
- [ ] Add optimistic concurrency checks to canvas saves.

Live multiplayer editing is deferred.

### Acceptance criteria

- Layout persists after reload.
- Real checkpoints populate histories.
- Branching preserves sources.
- Application type and supported actions are visible.
- Moving or connecting cards cannot rewrite version ancestry.

## 14. Phase 5 — Selective Combination and Approval

### Goal

Combine supported properties deterministically.

### Merge rules

Compare branches against their shared ancestor:

- Neither changed: retain the property.
- One changed: identify a candidate change.
- Both changed identically: compatible change.
- Both changed differently: explicit conflict resolution.

Respect explicit user selections and exclusions.

Require an explicit baseline when no unambiguous supported shared ancestor is available.

### Tasks

- [ ] Implement the merge engine.
- [ ] Bind proposals to exact source checkpoints.
- [ ] Validate supported objects and properties.
- [ ] Create a separate editable candidate.
- [ ] Export a preview of that candidate.
- [ ] Record approval of the exact candidate.
- [ ] Finalize the candidate as a new checkpoint.
- [ ] Preserve source checkpoints.
- [ ] Handle unsaved work before changing the open document.

Modified candidates require refreshed previews and approval.

### Acceptance criteria

- Combine one branch's font with another's background.
- Preserve unselected content.
- Require conflict resolution.
- Preserve all sources.
- Approved artifacts match their previews.

## 15. Phase 6 — Shared Themes and Project Directions

### Goal

Coordinate changes across assets through connector capabilities.

### Tasks

- [ ] Define primary, background, text, and accent color roles.
- [ ] Map roles explicitly to asset properties.
- [ ] Validate each asset independently.
- [ ] Generate per-asset candidates and previews.
- [ ] Support inclusion and exclusion of assets.
- [ ] Approve a collection of proposed changes.
- [ ] Track per-asset execution status.
- [ ] Save named directions using exact checkpoint IDs.

The demo uses two Photoshop documents.

Shared orchestration must use connector capabilities instead of assuming PSD-specific behavior.

Initially support RGB documents for palette application. Surface unsupported color modes before execution.

### Partial failure behavior

Multi-asset operations are not atomic.

- Preserve successful outputs.
- Show which assets failed.
- Do not mark partial completion as full completion.
- Allow independent reconciliation of failed items.

### Acceptance criteria

- One theme updates two documents through explicit mappings.
- Each result remains recoverable.
- A direction retrieves the intended checkpoint collection.
- Partial failures are visible.
- Unsupported assets cannot receive incompatible operations.

## 16. Phase 7 — Computer Vision

### Goal

Support palette creation and visual comparison.

### Palette extraction

- [ ] Analyze reference images.
- [ ] Return representative colors.
- [ ] Return approximate color proportions.
- [ ] Allow editing and semantic role assignment.
- [ ] Preserve the source reference.

### Difference highlighting

- [ ] Compare aligned previews with matching dimensions.
- [ ] Generate a difference overlay.
- [ ] Apply configurable noise thresholds.
- [ ] Identify incompatible inputs.
- [ ] Keep visual results separate from property differences.

Do not silently stretch incompatible images.

Computer vision describes appearance; document manifests remain authoritative for editing.

### Acceptance criteria

- Extracted colors populate an editable theme.
- Known changes produce useful overlays.
- Identical images produce no meaningful difference.
- Mismatched inputs return actionable responses.
- Private images remain protected during analysis.

## 17. Phase 8 — Text Commands and Review

### Goal

Expose working operations through natural language.

### Example commands

- "Compare Vintage and Modern."
- "Take Vintage's font and Modern's background."
- "Apply the Broadway palette to both posters."

### Tasks

- [ ] Produce structured proposals from text.
- [ ] Validate asset and checkpoint references.
- [ ] Validate permissions and connector capabilities.
- [ ] Request clarification for ambiguous references.
- [ ] Display interpreted changes before execution.
- [ ] Add comments and review decisions.
- [ ] Record approval authorship.

Never execute model-generated code or unrestricted application commands.

Comments remain feedback unless explicitly converted into proposals.

### Acceptance criteria

- Text and manual controls invoke the same operations.
- Unsupported and unauthorized requests are rejected.
- Ambiguity triggers clarification.
- Core workflows function without an LLM.

## 18. Phase 9 — Integration Testing and Demo Readiness

### Demo sequence

1. Connect two Photoshop documents.
2. Capture original checkpoints.
3. Create alternative poster branches.
4. Compare and combine selected changes.
5. Extract a palette from a reference.
6. Map the palette across both documents.
7. Preview and approve results.
8. Save a named creative direction.
9. Recover earlier checkpoints.

### Failure cases

- [ ] Missing fonts.
- [ ] Missing or replaced layers.
- [ ] Disconnected connectors.
- [ ] Expired authentication.
- [ ] Duplicate job delivery.
- [ ] Failed uploads.
- [ ] Stale candidates.
- [ ] Partial multi-asset completion.
- [ ] Unsaved document changes.

Clearly distinguish fixtures and mockups from working integrations.

### Acceptance criteria

- The full Photoshop workflow succeeds.
- Recovery and partial failures are verified.
- Limitations are documented.
- Another connector can be added without rewriting shared canvas, history, permission, or review systems.

## 19. Future Integrations

Potential future connectors include:

- Illustrator.
- Premiere Pro.
- After Effects.
- DaVinci Resolve.
- Additional creative tools.

Each requires a feasibility review covering:

- Available APIs and licensing.
- Native snapshot and restoration behavior.
- Object identity.
- Preview generation.
- Editable properties.
- Execution environment.
- Conflict handling.
- Recovery semantics.

Broad product scope does not imply universal support for every editing operation.

## 20. Deferred Features

- ElevenLabs and voice interaction.
- Native mobile applications.
- Live multiplayer canvas editing.
- Generic cross-format merging.
- Automatic cross-application asset transfer.
- Storage deduplication.
- Automatic capture of every editing action.
- Universal feature coverage inside connected applications.

## 21. Development Reporting

After each phase, update `docs/progress.md` with:

- Completed tasks.
- Files and migrations added or changed.
- Verification performed.
- Actual results.
- Known limitations.
- Blockers requiring user input.
- Recommended next phase.

Never claim tests or application operations ran when they did not.

Prefer the smallest implementation that satisfies the acceptance criteria.

**Begin with Phase 1. Inspect the environment, configure components, verify available services, and report readiness before proceeding.**