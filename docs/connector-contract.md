# Connector Contract

Status: **design draft (Phase 1)**. Zod schemas will be implemented in `packages/contracts`
during Phase 2 and proven against real Photoshop operations.

## Capability manifest

Each connector reports a manifest. The UI enables or disables actions from it and never
hardcodes per-application behavior.

```ts
type ConnectorManifest = {
  application: string; // "photoshop"
  connectorVersion: string; // semver
  applicationVersion?: string; // reported at runtime, e.g. "27.8.0"
  assetTypes: string[]; // ["psd"]
  operations: OperationName[]; // subset of the table below
  propertyTypes: PropertyType[]; // ["text.content", "text.fontFamily", "text.fontSize", "text.color", "fill.color"]
  previewFormats: string[]; // ["image/png"]
  runtime: Record<string, string>; // e.g. { uxp: ">=7", host: "PS>=24.0.0" }
  limitations: string[]; // human-readable
};
```

## Operations

| Operation           | Purpose                                          | Photoshop (demo) |
| ------------------- | ------------------------------------------------ | ---------------- |
| `discoverAssets`    | List available documents or projects             | planned          |
| `captureCheckpoint` | Native snapshot + preview + manifest, same state | planned          |
| `readProperties`    | Read supported editable elements                 | planned          |
| `validateProposal`  | Check that elements, fonts and resources exist   | planned          |
| `createCandidate`   | Apply changes to a separate editable copy        | planned          |
| `generatePreview`   | Render a candidate                               | planned          |
| `openCheckpoint`    | Reopen a saved version without overwriting       | planned          |
| `reportStatus`      | Connection and execution state                   | planned          |

Connectors don't have to implement every operation.

## Elements and properties

- **Stable Sonder element ids** (UUIDs) map to native objects through validated, connector-specific
  metadata, for example a Photoshop layer id plus a name fingerprint.
- **Roles** (`headline`, `body_text`, `background`, …) are assigned by users and validated before
  every operation.
- **Typed properties** are namespaced by kind (`text.*`, `fill.*`), not by application. A vector
  connector would expose paths and text objects; a video connector would expose clips and
  grading parameters. Nothing in the contract assumes layers.

## Operation categories

1. **Branch combination**: merges supported properties from versions of the same asset.
2. **Coordinated update**: applies a shared theme across assets, each through its own connector.
3. **Asset transfer**: moves content between applications. Out of scope for the demo.

## Transport (Phase 1 configuration)

- The plugin calls the web backend over HTTP. The plugin manifest allow-lists
  `http://localhost:3000` for development. Production origins must
  be added to `requiredPermissions.network.domains`.
- Phase 3 adds pairing: a signed-in user approves a plugin session in the web app, and the plugin
  receives an expiring connector token. Jobs are delivered by polling while the panel is open,
  with unique operation ids, leases and bounded retries.
- The plugin never receives Supabase secret keys or the vision service token.
