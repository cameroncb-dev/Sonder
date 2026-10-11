import { fnv1a64 } from "@sonder/connector-sdk";
import type { ArtifactFile } from "@sonder/contracts";
import { storage } from "uxp";

export type Folder = storage.Folder;
export type FileEntry = storage.File;

export async function readBytes(file: FileEntry): Promise<Uint8Array> {
  const data = await file.read({ format: storage.formats.binary });
  if (typeof data === "string") throw new Error(`Expected binary contents for ${file.name}`);
  return new Uint8Array(data);
}

export async function writeBytes(
  folder: Folder,
  name: string,
  bytes: Uint8Array,
): Promise<FileEntry> {
  const file = await folder.createFile(name, { overwrite: true });
  const copy = bytes.slice().buffer;
  await file.write(copy, { format: storage.formats.binary });
  return file;
}

export async function readJson<T>(folder: Folder, name: string): Promise<T> {
  const entry = await folder.getEntry(name);
  if (!entry.isFile) throw new Error(`${name} is not a file`);
  return JSON.parse(String(await (entry as FileEntry).read({ format: storage.formats.utf8 }))) as T;
}

export async function writeJson(folder: Folder, name: string, value: unknown): Promise<FileEntry> {
  const file = await folder.createFile(name, { overwrite: true });
  await file.write(`${JSON.stringify(value, null, 2)}\n`, { format: storage.formats.utf8 });
  return file;
}

export async function getFile(folder: Folder, name: string): Promise<FileEntry> {
  const entry = await folder.getEntry(name);
  if (!entry.isFile) throw new Error(`${name} is not a file`);
  return entry as FileEntry;
}

export async function getOrCreateFolder(parent: Folder, name: string): Promise<Folder> {
  try {
    const entry = await parent.getEntry(name);
    if (entry.isFolder) return entry as Folder;
  } catch {
    // Not found; create below.
  }
  return parent.createFolder(name);
}

export async function describeFile(file: FileEntry, mediaType: string): Promise<ArtifactFile> {
  const bytes = await readBytes(file);
  return { name: file.name, mediaType, bytes: bytes.length, digest: fnv1a64(bytes) };
}

/** Photoshop's typings use the DOM `File` name for UXP file entries. */
export const asPsEntry = (file: FileEntry) => file as unknown as File;
