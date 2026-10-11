import { ConnectorError } from "@sonder/connector-sdk";
import { host, storage } from "uxp";

import { PhotoshopConnector } from "./connector";
import { runFeasibilitySuite, type StepResult } from "./dev/suite";
import { startTriggerWatcher } from "./dev/trigger";
import { getOrCreateFolder } from "./ps/files";

const BACKEND_URL = "http://localhost:3000";
const connector = new PhotoshopConnector();
let running = false;

const $ = (id: string) => document.getElementById(id)!;

function log(text: string) {
  $("output").textContent = text;
}

async function checkBackend(): Promise<string> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/health`);
    if (!response.ok) return `HTTP ${response.status}`;
    const body = (await response.json()) as { status?: string };
    return body.status === "ok" ? "reachable" : "unexpected response";
  } catch (error) {
    return `unreachable (${error instanceof Error ? error.message : String(error)})`;
  }
}

async function refresh() {
  $("host").textContent = `${host.name} ${host.version}`;
  $("doc").textContent = connector.activeAsset()?.name ?? "(no document open)";
  $("backend").textContent = await checkBackend();
}

async function readActive() {
  const asset = connector.activeAsset();
  if (!asset) return log("Open a document first.");
  try {
    const { document: info, elements } = await connector.readProperties(asset);
    const lines = elements.map((e) => {
      const props = e.properties.map(
        (p) => `${p.type}=${typeof p.value === "object" ? p.value.postScriptName : p.value}`,
      );
      return `${e.kind} "${e.name}"${e.editable ? "" : " (not editable)"}\n  ${props.join("\n  ")}`;
    });
    log(
      `${info.name} ${info.width}x${info.height} ${info.colorMode}\n\n${lines.join("\n") || "No supported layers."}`,
    );
  } catch (error) {
    log(error instanceof ConnectorError ? error.message : String(error));
  }
}

async function runSuite(runId: string, root?: Parameters<typeof runFeasibilitySuite>[0]) {
  if (running) return;
  running = true;
  const lines: string[] = [`Running feasibility suite ${runId}…`];
  log(lines.join("\n"));
  try {
    const folder =
      root ??
      (await getOrCreateFolder(await storage.localFileSystem.getDataFolder(), "feasibility"));
    const report = await runFeasibilitySuite(folder, runId, (step: StepResult) => {
      lines.push(`${step.ok ? "PASS" : step.skipped ? "SKIP" : "FAIL"}  ${step.title}`);
      if (!step.ok && step.error) lines.push(`      ${step.error.message}`);
      log(lines.join("\n"));
    });
    lines.push("", `${report.passed} passed, ${report.failed} failed`, report.folder);
    log(lines.join("\n"));
  } catch (error) {
    lines.push(`Suite crashed: ${error instanceof Error ? error.message : String(error)}`);
    log(lines.join("\n"));
  } finally {
    running = false;
  }
}

$("refresh").addEventListener("click", () => void refresh());
$("read").addEventListener("click", () => void readActive());
$("suite").addEventListener("click", () => void runSuite(`manual-${Date.now()}`));

void refresh();
void startTriggerWatcher((runId, root) => runSuite(runId, root)).catch((error) =>
  log(`Dev trigger unavailable: ${String(error)}`),
);
