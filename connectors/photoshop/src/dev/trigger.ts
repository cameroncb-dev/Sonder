import { storage } from "uxp";

import { type Folder, getOrCreateFolder, readJson, writeJson } from "../ps/files";

/**
 * Development-only remote trigger. While the panel is open it polls
 * `<plugin data>/dev/trigger.json`; a new `runId` there starts the
 * feasibility suite. This lets a developer re-run real Photoshop checks from a
 * terminal. It reads only the plugin's own data folder and is not a job queue
 * (that is Phase 3).
 */
export async function startTriggerWatcher(
  run: (runId: string, root: Folder) => Promise<void>,
  intervalMs = 2000,
): Promise<Folder> {
  const data = await storage.localFileSystem.getDataFolder();
  const dev = await getOrCreateFolder(data, "dev");
  const root = await getOrCreateFolder(data, "feasibility");
  let busy = false;
  let lastRunId: string | undefined;
  try {
    lastRunId = (await readJson<{ runId?: string }>(dev, "last-run.json")).runId;
  } catch {
    // First start.
  }

  await writeJson(dev, "panel-ready.json", {
    at: new Date().toISOString(),
    dataFolder: data.nativePath,
  });

  setInterval(async () => {
    if (busy) return;
    let runId: string | undefined;
    try {
      runId = (await readJson<{ runId?: string }>(dev, "trigger.json")).runId;
    } catch {
      return;
    }
    if (!runId || runId === lastRunId || !/^[A-Za-z0-9_-]{1,64}$/.test(runId)) return;
    busy = true;
    lastRunId = runId;
    try {
      await writeJson(dev, "last-run.json", { runId, at: new Date().toISOString() });
      await run(runId, root);
    } finally {
      busy = false;
    }
  }, intervalMs);
  return root;
}
