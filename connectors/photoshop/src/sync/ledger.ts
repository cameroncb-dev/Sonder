import { load, save } from "./store";

/**
 * Operations this plugin has finished, keyed by operation id. If a job is
 * delivered again (e.g. the completion report was lost), the stored outcome is
 * re-reported instead of repeating the work.
 */
export interface LedgerEntry {
  operationId: string;
  result?: Record<string, unknown>;
  checkpointId?: string;
  at: string;
}

const FILE = "ledger.json";
const MAX_ENTRIES = 500;

export async function lookup(operationId: string): Promise<LedgerEntry | undefined> {
  const entries = await load<LedgerEntry[]>(FILE, []);
  return entries.find((e) => e.operationId === operationId);
}

export async function record(entry: Omit<LedgerEntry, "at">): Promise<void> {
  const entries = (await load<LedgerEntry[]>(FILE, [])).filter(
    (e) => e.operationId !== entry.operationId,
  );
  entries.push({ ...entry, at: new Date().toISOString() });
  await save(FILE, entries.slice(-MAX_ENTRIES));
}
