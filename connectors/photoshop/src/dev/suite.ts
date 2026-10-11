import { type AssetRef, ConnectorError, diffElements, fnv1a64 } from "@sonder/connector-sdk";
import {
  type ChangeSet,
  ConnectorManifest,
  type Element,
  type ElementMapping,
  type IssueCode,
  type PropertyValue,
} from "@sonder/contracts";
import { app, constants, core } from "photoshop";
import { host } from "uxp";

import { type PhotoshopCheckpoint, PhotoshopConnector } from "../connector";
import { elementKey, randomUuid } from "../core/identity";
import { CONNECTOR_VERSION } from "../core/manifest";
import { findDocument, findLayer } from "../ps/elements";
import { type Folder, getFile, readBytes, writeBytes, writeJson } from "../ps/files";
import { createFixture, FIXTURE, pickFonts } from "./fixture";

export interface StepResult {
  id: string;
  title: string;
  ok: boolean;
  skipped?: boolean;
  details?: unknown;
  error?: { message: string; issues?: unknown };
}

export interface SuiteReport {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  photoshopVersion: string;
  connectorVersion: string;
  folder: string;
  passed: number;
  failed: number;
  steps: StepResult[];
}

class AssertionError extends Error {}

function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    const error = new AssertionError(message);
    (error as AssertionError & { details?: unknown }).details = details;
    throw error;
  }
}

const prop = (element: Element | undefined, type: PropertyValue["type"]) =>
  element?.properties.find((p) => p.type === type)?.value;

const byName = (elements: Element[], name: string) => elements.find((e) => e.name === name);

/**
 * Runs every Phase 2 check against real Photoshop documents. Each step records
 * what it observed; nothing is simulated. Documents the suite opens are closed
 * without saving at the end.
 */
export async function runFeasibilitySuite(
  root: Folder,
  runId: string,
  onProgress: (step: StepResult) => void = () => {},
): Promise<SuiteReport> {
  const connector = new PhotoshopConnector();
  const runFolder = await root.createFolder(`run-${runId}`);
  const report: SuiteReport = {
    runId,
    startedAt: new Date().toISOString(),
    photoshopVersion: host.version,
    connectorVersion: CONNECTOR_VERSION,
    folder: runFolder.nativePath,
    passed: 0,
    failed: 0,
    steps: [],
  };
  const opened: AssetRef[] = [];
  const state: {
    fonts?: [string, string];
    mappings?: ElementMapping[];
    source?: PhotoshopCheckpoint;
    candidate?: PhotoshopCheckpoint;
    sourceDigest?: string;
  } = {};

  const step = async (id: string, title: string, needs: unknown[], fn: () => Promise<unknown>) => {
    const result: StepResult = { id, title, ok: false };
    if (needs.some((n) => n === undefined)) {
      result.skipped = true;
      result.error = { message: "Skipped: a previous step failed" };
    } else {
      try {
        result.details = await fn();
        result.ok = true;
      } catch (error) {
        result.error = {
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof ConnectorError ? { issues: error.issues } : {}),
          ...((error as { details?: unknown }).details
            ? { issues: (error as { details?: unknown }).details }
            : {}),
        };
      }
    }
    report.steps.push(result);
    if (result.ok) report.passed++;
    else report.failed++;
    onProgress(result);
  };

  const open = async (checkpoint: PhotoshopCheckpoint, name: string) => {
    const asset = await connector.openCheckpoint(checkpoint, runFolder, name);
    opened.push(asset);
    return asset;
  };

  const expectIssue = async (code: IssueCode, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      if (
        result &&
        typeof result === "object" &&
        "ok" in result &&
        result.ok === false &&
        "issues" in result
      ) {
        const issues = (result as { issues: Array<{ code: string; message: string }> }).issues;
        assert(
          issues.some((i) => i.code === code),
          `Expected ${code}`,
          issues,
        );
        return issues;
      }
    } catch (error) {
      assert(
        error instanceof ConnectorError,
        `Expected ConnectorError ${code}, got ${String(error)}`,
      );
      assert(
        error.issues.some((i) => i.code === code),
        `Expected ${code}`,
        error.issues,
      );
      return error.issues;
    }
    throw new AssertionError(`Expected ${code} but the operation succeeded`);
  };

  try {
    await step("capabilities", "Report connector capabilities", [], async () => {
      const manifest = ConnectorManifest.parse(connector.manifest());
      assert(manifest.operations.includes("createCandidate"), "createCandidate not declared");
      return manifest;
    });

    await step(
      "fixture",
      "Create test PSD with text and a solid-color background",
      [],
      async () => {
        state.fonts = pickFonts();
        const file = await createFixture(runFolder, state.fonts[0]);
        return { path: file.nativePath, fonts: state.fonts };
      },
    );

    await step("discover", "Discover supported layers", [state.fonts], async () => {
      const fixtureFile = await getFile(runFolder, "fixture.psd");
      const doc = await core.executeAsModal(() => app.open(fixtureFile as unknown as File), {
        commandName: "Sonder: open fixture",
      });
      const asset = { id: String(doc.id), name: doc.name };
      opened.push(asset);
      const { elements } = await connector.readProperties(asset);
      const kinds = elements.map((e) => `${e.kind}:${e.name}`);
      assert(
        elements.filter((e) => e.kind === "text").length === 2,
        "Expected two text layers",
        kinds,
      );
      assert(
        elements.filter((e) => e.kind === "solid_fill").length === 1,
        "Expected one solid fill",
        kinds,
      );

      const headline = byName(elements, FIXTURE.headline.layerName);
      const body = byName(elements, FIXTURE.body.layerName);
      const background = byName(elements, FIXTURE.background.layerName);
      assert(headline && body && background, "Fixture layers not found by name", kinds);
      state.mappings = [
        { elementId: randomUuid(), role: "headline", kind: "text", native: headline.native },
        { elementId: randomUuid(), role: "body_text", kind: "text", native: body.native },
        {
          elementId: randomUuid(),
          role: "background",
          kind: "solid_fill",
          native: background.native,
        },
      ];
      return { asset, elements: kinds };
    });

    const fixtureAsset = () => opened[0]!;
    const mapping = (role: string) => state.mappings!.find((m) => m.role === role)!;

    await step("roles", "Assign and validate element roles", [state.mappings], async () => {
      const valid = await connector.validateMappings(fixtureAsset(), state.mappings!);
      assert(valid.ok, "Valid mappings were rejected", valid);
      const wrongKind = state.mappings!.map((m) =>
        m.role === "background" ? { ...m, kind: "text" as const } : m,
      );
      const issues = await expectIssue("ELEMENT_KIND_MISMATCH", () =>
        connector.validateMappings(fixtureAsset(), wrongKind),
      );
      return {
        roles: state.mappings!.map((m) => `${m.role} -> layer ${String(m.native.data.layerId)}`),
        wrongKind: issues,
      };
    });

    await step("read", "Read supported properties", [state.mappings], async () => {
      const { document, elements } = await connector.readProperties(fixtureAsset());
      const headline = byName(elements, FIXTURE.headline.layerName);
      const background = byName(elements, FIXTURE.background.layerName);
      const observed = {
        headline: {
          content: prop(headline, "text.content"),
          font: prop(headline, "text.font"),
          size: prop(headline, "text.size"),
          color: prop(headline, "text.color"),
          editable: headline?.editable,
        },
        background: prop(background, "fill.color"),
        document,
      };
      assert(
        observed.headline.content === FIXTURE.headline.contents,
        "Headline content mismatch",
        observed,
      );
      assert(
        (observed.headline.font as { postScriptName?: string } | undefined)?.postScriptName ===
          state.fonts![0],
        "Headline font mismatch",
        observed,
      );
      assert(
        Math.abs(Number(observed.headline.size) - FIXTURE.headline.size) < 0.01,
        "Headline size mismatch",
        observed,
      );
      assert(
        observed.headline.color === FIXTURE.headline.color,
        "Headline color mismatch",
        observed,
      );
      assert(
        observed.background === FIXTURE.background.color,
        "Background color mismatch",
        observed,
      );
      assert(
        observed.headline.editable === true,
        "Uniform text reported as not editable",
        observed,
      );
      return observed;
    });

    await step(
      "capture",
      "Capture snapshot, preview and manifest from one state",
      [state.mappings],
      async () => {
        state.source = await connector.captureCheckpoint(fixtureAsset(), runFolder, "source");
        const { native, preview } = state.source.manifest.files;
        state.sourceDigest = native.digest;
        const loaded = await connector.loadCheckpoint(runFolder, "source");
        assert(loaded.manifest.files.native.digest === native.digest, "Reloaded manifest differs");
        return { native, preview, elements: state.source.manifest.elements.length };
      },
    );

    await step(
      "candidate",
      "Change headline font and background color on an editable copy",
      [state.source],
      async () => {
        const changes: ChangeSet = {
          mappings: state.mappings!,
          changes: [
            {
              elementId: mapping("headline").elementId,
              property: { type: "text.font", value: { postScriptName: state.fonts![1] } },
            },
            {
              elementId: mapping("background").elementId,
              property: { type: "fill.color", value: "#8B1E3F" },
            },
          ],
        };
        state.candidate = await connector.createCandidate(
          state.source!,
          changes,
          runFolder,
          "candidate",
        );
        const elements = state.candidate.manifest.elements;
        const observed = {
          headlineFont: prop(byName(elements, FIXTURE.headline.layerName), "text.font"),
          background: prop(byName(elements, FIXTURE.background.layerName), "fill.color"),
        };
        assert(
          (observed.headlineFont as { postScriptName: string }).postScriptName === state.fonts![1],
          "Candidate font not changed",
          observed,
        );
        assert(observed.background === "#8B1E3F", "Candidate background not changed", observed);
        return observed;
      },
    );

    await step("source-intact", "Source snapshot is unchanged", [state.candidate], async () => {
      const bytes = await readBytes(await getFile(runFolder, "source.psd"));
      assert(fnv1a64(bytes) === state.sourceDigest, "Source snapshot bytes changed");
      return { digest: state.sourceDigest, bytes: bytes.length };
    });

    await step(
      "candidate-editable",
      "Candidate reopens with live, editable text",
      [state.candidate],
      async () => {
        const asset = await open(state.candidate!, "candidate-reopened.psd");
        const { elements } = await connector.readProperties(asset);
        const differences = diffElements(state.candidate!.manifest.elements, elements, elementKey);
        assert(
          differences.length === 0,
          "Reopened candidate differs from its manifest",
          differences,
        );
        const headline = byName(elements, FIXTURE.headline.layerName);
        assert(
          headline?.kind === "text" && headline.editable,
          "Headline is no longer an editable text layer",
        );
        assert(
          prop(byName(elements, FIXTURE.body.layerName), "text.content") === FIXTURE.body.contents,
          "Body changed",
        );

        const doc = findDocument(Number(asset.id))!;
        await core.executeAsModal(
          async () => {
            app.activeDocument = doc;
            findLayer(doc, Number(headline.native.data.layerId))!.textItem.contents =
              "Edited after reopen";
          },
          { commandName: "Sonder: edit candidate" },
        );
        const after = byName(
          (await connector.readProperties(asset)).elements,
          FIXTURE.headline.layerName,
        );
        assert(
          prop(after, "text.content") === "Edited after reopen",
          "Text edit on reopened candidate failed",
        );
        return { unchanged: ["body", "headline content"], editCheck: "ok" };
      },
    );

    await step("preview", "Export a preview of the candidate", [state.candidate], async () => {
      const preview = await connector.generatePreview(
        opened[opened.length - 1]!,
        runFolder,
        "candidate-edited.png",
      );
      const { preview: sourcePreview } = state.source!.manifest.files;
      const { preview: candidatePreview } = state.candidate!.manifest.files;
      assert(preview.bytes > 0 && candidatePreview.bytes > 0, "Empty preview");
      assert(
        candidatePreview.digest !== sourcePreview.digest,
        "Candidate preview is identical to source preview",
      );
      return { source: sourcePreview, candidate: candidatePreview, standalone: preview };
    });

    await step(
      "reopen",
      "Reopen the saved source snapshot with expected content",
      [state.source],
      async () => {
        const asset = await open(state.source!, "source-reopened.psd");
        const { elements } = await connector.readProperties(asset);
        const differences = diffElements(state.source!.manifest.elements, elements, elementKey);
        assert(
          differences.length === 0,
          "Reopened snapshot differs from its manifest",
          differences,
        );
        return { elements: elements.length, differences };
      },
    );

    await step(
      "missing-font",
      "Missing fonts produce explicit errors",
      [state.source],
      async () => {
        const changes: ChangeSet = {
          mappings: state.mappings!,
          changes: [
            {
              elementId: mapping("headline").elementId,
              property: {
                type: "text.font",
                value: { postScriptName: "SonderMissingFont-Regular" },
              },
            },
          ],
        };
        const validation = await expectIssue("MISSING_FONT", () =>
          connector.validateProposal(opened[opened.length - 1]!, changes),
        );
        const candidate = await expectIssue("MISSING_FONT", () =>
          connector.createCandidate(state.source!, changes, runFolder, "missing-font"),
        );
        let manifestWritten = true;
        try {
          await connector.loadCheckpoint(runFolder, "missing-font");
        } catch {
          manifestWritten = false;
        }
        assert(!manifestWritten, "A failed candidate left a recoverable checkpoint");
        return { validation, candidate };
      },
    );

    await step(
      "missing-layer",
      "Missing layers produce explicit errors",
      [state.source],
      async () => {
        const asset = await open(state.source!, "missing-layer.psd");
        const doc = findDocument(Number(asset.id))!;
        await core.executeAsModal(
          async () => {
            app.activeDocument = doc;
            findLayer(doc, Number(mapping("body_text").native.data.layerId))!.delete();
          },
          { commandName: "Sonder: delete layer" },
        );
        return expectIssue("ELEMENT_NOT_FOUND", () =>
          connector.validateMappings(asset, state.mappings!),
        );
      },
    );

    await step(
      "incomplete",
      "Snapshots without a manifest are not recoverable",
      [state.source],
      async () => {
        await writeBytes(
          runFolder,
          "partial.psd",
          await readBytes(await getFile(runFolder, "source.psd")),
        );
        return expectIssue("CHECKPOINT_INCOMPLETE", () =>
          connector.loadCheckpoint(runFolder, "partial"),
        );
      },
    );
  } finally {
    await core.executeAsModal(
      async () => {
        for (const asset of opened) {
          await findDocument(Number(asset.id))?.close(constants.SaveOptions.DONOTSAVECHANGES);
        }
      },
      { commandName: "Sonder: close suite documents" },
    );
    report.finishedAt = new Date().toISOString();
    await writeJson(runFolder, "report.json", report);
    await writeJson(root, "latest-report.json", report);
  }
  return report;
}
