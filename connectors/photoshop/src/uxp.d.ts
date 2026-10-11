/** Minimal typings for the parts of the UXP runtime this connector uses. */
declare module "uxp" {
  export namespace storage {
    interface Entry {
      readonly name: string;
      readonly nativePath: string;
      readonly isFile: boolean;
      readonly isFolder: boolean;
      delete(): Promise<void>;
    }
    interface File extends Entry {
      read(options?: { format?: symbol }): Promise<string | ArrayBuffer>;
      write(data: string | ArrayBuffer, options?: { format?: symbol }): Promise<number>;
    }
    interface Folder extends Entry {
      createFile(name: string, options?: { overwrite?: boolean }): Promise<File>;
      createFolder(name: string): Promise<Folder>;
      getEntry(path: string): Promise<File | Folder>;
      getEntries(): Promise<Array<File | Folder>>;
    }
    const localFileSystem: {
      getDataFolder(): Promise<Folder>;
      getPluginFolder(): Promise<Folder>;
    };
    const formats: { readonly utf8: symbol; readonly binary: symbol };
  }
  export const host: { readonly name: string; readonly version: string };
}
