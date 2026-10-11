import { storage } from "uxp";

import { type Folder, getOrCreateFolder, readJson, writeJson } from "../ps/files";

/**
 * Small JSON files in the plugin's private data folder. The connector token is
 * kept here so a panel reload does not force re-pairing; it expires server-side.
 */
let folder: Promise<Folder> | undefined;

export function connectorFolder(): Promise<Folder> {
  folder ??= storage.localFileSystem
    .getDataFolder()
    .then((data) => getOrCreateFolder(data, "connector"));
  return folder;
}

export async function load<T>(name: string, fallback: T): Promise<T> {
  try {
    return await readJson<T>(await connectorFolder(), name);
  } catch {
    return fallback;
  }
}

export async function save(name: string, value: unknown): Promise<void> {
  await writeJson(await connectorFolder(), name, value);
}
