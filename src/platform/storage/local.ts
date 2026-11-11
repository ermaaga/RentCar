import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";

import { STORAGE_KEY, type StoragePort, type StoredObject } from "./port";

// Local disk adapter (ADR-0009, docs/06-backend-api.md 10.3 step 8): for the Docker host with a
// persistent volume. Every key is re-checked against the allowed shape and the resolved path must stay
// inside the root (path containment), so a crafted key can never read or write elsewhere. Writes go
// to a temporary file and are renamed, so a reader never sees half an object.

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".zip": "application/zip",
};

export function createLocalStorage(rootDir: string): StoragePort {
  const root = resolve(rootDir);

  function pathFor(key: string): string {
    if (!STORAGE_KEY.test(key) || key.includes("..")) {
      throw new Error("invalid storage key");
    }
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) {
      throw new Error("storage key escapes the root");
    }
    return full;
  }

  return {
    async put(key: string, body: Buffer): Promise<void> {
      const full = pathFor(key);
      await mkdir(dirname(full), { recursive: true });
      const temp = `${full}.${String(process.pid)}.${String(Date.now())}.tmp`;
      await writeFile(temp, body, { mode: 0o640 });
      await rename(temp, full);
    },
    async get(key: string): Promise<StoredObject | null> {
      const full = pathFor(key);
      try {
        return { body: await readFile(full), contentType: CONTENT_TYPES[extname(full)] ?? "" };
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return null;
        throw err;
      }
    },
    async delete(key: string): Promise<void> {
      await rm(pathFor(key), { force: true });
    },
  };
}
