// Phase 1 smoke test: proves the plugin loads, can read the active document,
// and can reach the Sonder backend. No document edits happen here.
const { app } = require("photoshop");
const uxp = require("uxp");

const BACKEND_URL = "http://localhost:3000";

function readActiveDocumentName() {
  const doc = app.activeDocument;
  return doc ? doc.name : "(no document open)";
}

async function checkBackend() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/health`);
    if (!response.ok) return `HTTP ${response.status}`;
    const body = await response.json();
    return body.status === "ok" ? "reachable" : "unexpected response";
  } catch (error) {
    return `unreachable (${error.message})`;
  }
}

async function refresh() {
  document.getElementById("host").textContent = `${uxp.host.name} ${uxp.host.version}`;
  try {
    document.getElementById("doc").textContent = readActiveDocumentName();
  } catch (error) {
    document.getElementById("doc").textContent = `error: ${error.message}`;
  }
  document.getElementById("backend").textContent = await checkBackend();
}

document.getElementById("refresh").addEventListener("click", refresh);
refresh();
