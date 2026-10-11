import { storage } from "uxp";

import { type Folder, getOrCreateFolder, readJson, writeJson } from "../ps/files";

export interface TriggerCommand {
  runId: string;
  /** Defaults to "suite". */
  action?: string;
  [key: string]: unknown;
}

export type TriggerHandlers = Record<
  string,
  (command: TriggerCommand, root: Folder) => Promise<unknown>
>;

/**
 * Development-only remote trigger. While the panel is open it polls
 * `<plugin data>/dev/trigger.json`; a new `runId` runs the named action and
 * writes `dev/result-<runId>.json`. It reads only the plugin's own data folder
 * and is not the job transport (connector jobs come from the backend).
 */
export async function startTriggerWatcher(
  handlers: TriggerHandlers,
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
    let command: TriggerCommand | undefined;
    try {
      command = await readJson<TriggerCommand>(dev, "trigger.json");
    } catch {
      return;
    }
    const runId = command?.runId;
    if (!runId || runId === lastRunId || !/^[A-Za-z0-9_-]{1,64}$/.test(runId)) return;
    busy = true;
    lastRunId = runId;
    const action = command.action ?? "suite";
    try {
      await writeJson(dev, "last-run.json", { runId, action, at: new Date().toISOString() });
      const handler = handlers[action];
      if (!handler) throw new Error(`Unknown action ${action}`);
      const result = await handler(command, root);
      await writeJson(dev, `result-${runId}.json`, { ok: true, action, result });
    } catch (error) {
      await writeJson(dev, `result-${runId}.json`, {
        ok: false,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      busy = false;
    }
  }, intervalMs);
  return root;
}
