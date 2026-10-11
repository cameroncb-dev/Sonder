# Connector Contract

Status: **implemented (Phase 2)** and proven against real Photoshop 27.8.0 operations.

| Package                  | Contents                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `packages/contracts`     | Zod schemas: manifest, elements, properties, change sets, checkpoints, issues          |
| `packages/connector-sdk` | `Connector` interface, `ConnectorError`, app-agnostic validation, digest, element diff |
| `connectors/photoshop`   | Photoshop implementation (UXP), feasibility suite                                      |

Both shared packages compile against `lib: ES2022` with no DOM or Node types, so they run in
UXP, Node and browsers.

## Capability manifest

Each connector reports a `ConnectorManifest`. The UI enables or disables actions from it and
never hardcodes per-application behavior. Photoshop's manifest:

```ts
{
  application: "photoshop",
  connectorVersion: "0.2.0",
  applicationVersion: "27.8.0",            // host.version at runtime
  assetTypes: ["psd"],
  operations: ["discoverAssets", "readProperties", "validateProposal", "captureCheckpoint",
               "createCandidate", "generatePreview", "openCheckpoint", "reportStatus"],
  elementKinds: [
    { kind: "text", properties: ["text.content", "text.font", "text.size", "text.color"] },
    { kind: "solid_fill", properties: ["fill.color"] },
  ],
  previewFormats: ["image/png"],
  colorModes: ["RGBColorMode"],
  runtime: { host: "PS>=24.2.0", uxp: "manifest v5" },
  limitations: [/* see connectors/photoshop/src/core/manifest.ts */],
}
```

`supportsOperation(manifest, op)` in the SDK is the single check callers use.

## Operations

| Operation           | Purpose                                      | Photoshop                         |
| ------------------- | -------------------------------------------- | --------------------------------- |
| `discoverAssets`    | List open documents                          | implemented                       |
| `readProperties`    | Read supported elements and their properties | verified                          |
| `validateProposal`  | Schema, mappings, kinds, fonts, color mode   | verified                          |
| `captureCheckpoint` | Snapshot + preview + manifest from one state | verified                          |
| `createCandidate`   | Apply changes to a separate editable copy    | verified                          |
| `generatePreview`   | Export a PNG of an open document             | verified                          |
| `openCheckpoint`    | Reopen a copy of a saved snapshot            | verified                          |
| `reportStatus`      | Connection and execution state               | panel only (transport in Phase 3) |

"Verified" means the feasibility suite exercised it in Photoshop and checked the result.
`discoverAssets` is implemented, but the suite doesn't call it directly.

## Elements and properties

- **Element kinds** are generic: `text` and `solid_fill`. Photoshop maps them to text layers and
  solid-color fill layers. Other layer kinds are preserved in snapshots and ignored by
  `readProperties`.
- **Native refs** are connector-specific: `{ connector: "photoshop", data: { layerId, layerName } }`.
  The layer id is the identity, and it survives save and reopen. The name is for messages only.
  Deleted-and-recreated layers are never matched by name.
- **Element mappings** link a Sonder `elementId` (UUID) and a `role` (`lower_snake_case`) to a
  native ref and kind. They are validated before every operation.
- **Properties** are a discriminated union on `type`:

  | Type           | Value                                 |
  | -------------- | ------------------------------------- |
  | `text.content` | string                                |
  | `text.font`    | `{ postScriptName, family?, style? }` |
  | `text.size`    | points (number)                       |
  | `text.color`   | `#RRGGBB`                             |
  | `fill.color`   | `#RRGGBB`                             |

- An element is `editable: false` when it exists but can't be changed safely. For Photoshop
  that's a text layer with more than one font, size or color.

## Validation and errors

Validation runs in two stages, and failures are structured `Issue`s, never strings:

1. **App-agnostic**, in the SDK's `validateChangeSetShape`: schema, duplicate roles or elements,
   changes on unmapped elements, and properties the element kind doesn't support.
2. **Native**, in the connector: the layer exists (`ELEMENT_NOT_FOUND`), the kind matches
   (`ELEMENT_KIND_MISMATCH`), the layer is editable (`ELEMENT_NOT_EDITABLE`), the font is
   installed (`MISSING_FONT`), and color changes need RGB (`UNSUPPORTED_COLOR_MODE`).

After applying changes, the connector reads every changed property back. If Photoshop silently
did something else, the operation fails with `APPLICATION_ERROR`. This check caught a real
case during Phase 2 (see below).

## Checkpoints

A checkpoint is three files written from one document state inside a single
`executeAsModal` scope, so no user edit can interleave:

- `<name>.psd`: native snapshot (save-as-copy; the open document is unaffected).
- `<name>.png`: preview.
- `<name>.manifest.json`: `CheckpointManifest` with document info, elements, and each file's
  size and FNV-1a 64 digest. It is written **last**.

A checkpoint is recoverable only when its manifest exists, parses, and matches the snapshot's
size and digest. Otherwise the result is `CHECKPOINT_INCOMPLETE`.

- **`openCheckpoint`** copies the snapshot to a working file and opens the copy, so saving in
  Photoshop can never overwrite a snapshot.
- **`createCandidate`** opens a working copy of the source, validates against it, applies the
  changes, verifies them, captures a new checkpoint, then closes and deletes the working copy.
  The source snapshot is only read.

## Photoshop findings (27.8.0)

- `Document.createTextLayer({ name })` ignores `name`; layers are named after their contents.
  Rename the layer after creating it.
- `set` on a `contentLayer` addressed by `_id` is a silent no-op for solid-fill color. Select the
  layer, then target it with `{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }`.
- Text and fill reads use the DOM (`textItem.characterStyle`) and `batchPlay get` (`textKey`,
  `adjustment`). Fill colors use `grain` for the green channel.
- Use 72 ppi documents in tests so points and pixels are equal and sizes round-trip exactly.

## Operation categories

1. **Branch combination**: merges supported properties from versions of the same asset.
2. **Coordinated update**: applies a shared theme across assets, each through its own connector.
3. **Asset transfer**: moves content between applications. Out of scope for the demo.

## Transport

- The plugin calls the web backend over HTTP. The plugin manifest allow-lists
  `http://localhost:3000` for development. Production origins must be added to
  `requiredPermissions.network.domains`.
- Phase 3 adds pairing: a signed-in user approves a plugin session in the web app, and the plugin
  receives an expiring connector token. Jobs are delivered by polling while the panel is open,
  with unique operation ids, leases and bounded retries.
- The plugin never receives Supabase secret keys or the vision service token.
- The development trigger (`<plugin data>/dev/trigger.json`) is only for running the feasibility
  suite from a terminal. It reads the plugin's own data folder and is not a job transport.
