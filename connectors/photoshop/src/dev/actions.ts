import { app, constants, core } from "photoshop";

import { PropertyValue } from "@sonder/contracts";

import { applyProperty } from "../ps/apply";
import { allLayers } from "../ps/elements";
import { getFile, getOrCreateFolder, type Folder } from "../ps/files";
import type { ConnectorRuntime } from "../sync/runtime";
import { documentPath } from "../sync/runtime";
import { createFixture, pickFonts } from "./fixture";
import type { TriggerCommand, TriggerHandlers } from "./trigger";

/** Development actions for driving end-to-end checks from a terminal. */
export function devActions(
  runtime: ConnectorRuntime,
  runSuite: (runId: string, root: Folder) => Promise<unknown>,
): TriggerHandlers {
  return {
    suite: (command, root) => runSuite(command.runId, root),
    pair: async () => {
      await runtime.pair();
      return runtime.status.connection;
    },
    disconnect: async () => {
      await runtime.disconnect();
      return runtime.status.connection;
    },
    /** Creates a saved fixture PSD in a fresh folder and leaves it open, returning its path. */
    "open-fixture": async (command: TriggerCommand, root: Folder) => {
      // A new folder per run: overwriting a PSD that is still open in Photoshop blocks on a dialog.
      const folder = await getOrCreateFolder(root, `docs-${command.runId}`);
      await createFixture(folder, pickFonts()[0]);
      const file = await getFile(folder, "fixture.psd");
      const doc = await core.executeAsModal(() => app.open(file as unknown as File), {
        commandName: "Sonder: open e2e document",
      });
      return { path: documentPath(doc), name: doc.name };
    },
    /** Closes open documents whose path contains `match`, without saving. */
    "close-docs": async (command: TriggerCommand) => {
      if (typeof command.match !== "string" || command.match.length < 8)
        throw new Error("match required");
      const closed: string[] = [];
      await core.executeAsModal(
        async () => {
          for (let i = app.documents.length - 1; i >= 0; i--) {
            const doc = app.documents[i];
            const path = doc && documentPath(doc);
            if (doc && path?.includes(command.match as string)) {
              closed.push(path);
              doc.closeWithoutSaving();
            }
          }
        },
        { commandName: "Sonder: close e2e documents" },
      );
      return { closed };
    },
    /** Changes the first text layer of the active document without saving (makes it dirty). */
    "edit-text": async (command: TriggerCommand) => {
      const text = typeof command.text === "string" ? command.text : "Edited";
      return core.executeAsModal(
        async () => {
          const doc = app.activeDocument;
          if (!doc) throw new Error("No active document");
          const layer = allLayers(doc).find((l) => l.kind === constants.LayerKind.TEXT);
          if (!layer) throw new Error("No text layer");
          layer.textItem.contents = text;
          return { document: doc.name, layer: layer.name, saved: doc.saved };
        },
        { commandName: "Sonder: e2e edit" },
      );
    },
    /** Applies one typed property to the named layer of the active document (unsaved). */
    "set-property": async (command: TriggerCommand) => {
      const property = PropertyValue.parse(command.property);
      if (typeof command.layer !== "string") throw new Error("layer required");
      return core.executeAsModal(
        async () => {
          const doc = app.activeDocument;
          if (!doc) throw new Error("No active document");
          const layer = allLayers(doc).find((l) => l.name === command.layer);
          if (!layer) throw new Error(`No layer named ${String(command.layer)}`);
          await applyProperty(doc, layer, property);
          return { document: doc.name, layer: layer.name, property };
        },
        { commandName: "Sonder: e2e set property" },
      );
    },
    /** The two installed fonts the fixture and checks use (the fixture uses the first). */
    fonts: async () => pickFonts(),
    "save-active": async () =>
      core.executeAsModal(
        async () => {
          const doc = app.activeDocument;
          if (!doc) throw new Error("No active document");
          await doc.save();
          return { document: doc.name, path: documentPath(doc), saved: doc.saved };
        },
        { commandName: "Sonder: e2e save" },
      ),
    link: async (command: TriggerCommand) => {
      if (typeof command.projectId !== "string") throw new Error("projectId required");
      return runtime.linkActiveDocument(command.projectId);
    },
    fault: async (command: TriggerCommand) => {
      if (command.stage !== "before-finalize") throw new Error("Unknown fault stage");
      runtime.injectFault("before-finalize");
      return { armed: command.stage };
    },
    status: async () => runtime.status,
  };
}
