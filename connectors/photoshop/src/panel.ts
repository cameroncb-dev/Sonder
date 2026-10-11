import { ConnectorError } from "@sonder/connector-sdk";
import { action, app } from "photoshop";
import { host, storage } from "uxp";

import { PhotoshopConnector } from "./connector";
import { devActions } from "./dev/actions";
import { runFeasibilitySuite, type StepResult } from "./dev/suite";
import { startTriggerWatcher } from "./dev/trigger";
import { getOrCreateFolder } from "./ps/files";
import { BACKEND_URL } from "./sync/api";
import { ConnectorRuntime, documentPath, type RuntimeStatus } from "./sync/runtime";

const connector = new PhotoshopConnector();
const runtime = new ConnectorRuntime();
let running = false;
let linking = false;
/**
 * Selected project. Tracked here because UXP's <select> does not reliably report `.value`
 * for a selection the user did not change (it read as empty while showing the first option).
 */
let selectedProject = "";
/** Last panel message and UI error, reported by the dev "ui" action for diagnosis. */
let lastMessage = "";
let lastUiError: string | undefined;

const $ = (id: string) => document.getElementById(id)!;

function log(text: string) {
  lastMessage = text;
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
  renderLinkButton();
  $("backend").textContent = await checkBackend();
}

/** "Linked" when the active document is already linked to the selected project. */
function renderLinkButton() {
  const button = $("link");
  let linked = false;
  try {
    const doc = app.activeDocument;
    const path = doc ? documentPath(doc) : undefined;
    linked =
      !!path &&
      runtime.status.assets.some((a) => a.path === path && a.projectId === selectedProject);
    lastUiError = undefined;
  } catch (error) {
    // Never leave the button stuck because Photoshop refused a read (e.g. while modal).
    lastUiError = String(error);
  }
  button.textContent = linking ? "Linking…" : linked ? "Linked" : "Link active document";
  if (linking || linked) button.setAttribute("disabled", "");
  else button.removeAttribute("disabled");
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

function renderConnection(status: RuntimeStatus) {
  const c = status.connection;
  const text =
    c.state === "active"
      ? `Connected as ${c.user.email ?? c.user.id} until ${new Date(c.expiresAt).toLocaleString()}`
      : c.state === "pairing"
        ? `Enter code ${c.code} at ${BACKEND_URL}/pair`
        : c.state === "expired"
          ? c.reason
          : "Not connected";
  $("connection").textContent = text;
  $("connect").textContent = c.state === "active" ? "Disconnect" : "Connect";
  $("linking").hidden = c.state !== "active";
  const job = status.lastJob;
  $("jobs").textContent = [
    `Linked documents open: ${status.assets.length}`,
    job ? `Last job: ${job.operation} (attempt ${job.attempt}) — ${job.outcome}` : "",
    status.error ? `Error: ${status.error}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  renderLinkButton();
}

async function loadProjects() {
  const api = runtime.api();
  if (!api) return;
  const { projects } = await api.projects();
  const select = $("project") as HTMLSelectElement;
  select.innerHTML = "";
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    select.appendChild(option);
  }
  // Keep the current choice if it still exists; otherwise default to the first project.
  if (!projects.some((p) => p.id === selectedProject)) selectedProject = projects[0]?.id ?? "";
  for (const option of Array.from(select.options))
    option.selected = option.value === selectedProject;
  renderLinkButton();
}

$("connect").addEventListener("click", () => {
  const action =
    runtime.status.connection.state === "active" ? runtime.disconnect() : runtime.pair();
  void action.catch((error) => log(String(error)));
});
$("reload-projects").addEventListener(
  "click",
  () => void loadProjects().catch((error) => log(String(error))),
);
$("link").addEventListener("click", () => {
  const projectId = selectedProject;
  if (!projectId) return log("Choose a project first.");
  if (linking) return;
  linking = true;
  renderLinkButton();
  void runtime
    .linkActiveDocument(projectId)
    .then((asset) => log(`Linked "${asset.name}" to the project.`))
    .catch((error) => log(String(error)))
    .finally(() => {
      linking = false;
      renderLinkButton();
    });
});
$("project").addEventListener("change", (event) => {
  selectedProject = (event.target as HTMLSelectElement).value;
  renderLinkButton();
});
// Keep the active document and link state current as documents are switched, opened or closed.
void action.addNotificationListener(["select", "open", "close", "save"], () => void refresh());
$("refresh").addEventListener("click", () => void refresh());
$("read").addEventListener("click", () => void readActive());
$("suite").addEventListener("click", () => void runSuite(`manual-${Date.now()}`));

runtime.onChange(renderConnection);
void runtime.start().then(() => loadProjects().catch(() => undefined));
void refresh();
void startTriggerWatcher({
  ...devActions(runtime, (runId, root) => runSuite(runId, root)),
  ui: async () => {
    const button = $("link");
    return {
      linkButton: { text: button.textContent, disabled: button.hasAttribute("disabled") },
      linking,
      project: selectedProject,
      activeDocument: app.activeDocument ? documentPath(app.activeDocument) : null,
      lastMessage,
      lastUiError,
    };
  },
}).catch((error) => log(`Dev trigger unavailable: ${String(error)}`));
