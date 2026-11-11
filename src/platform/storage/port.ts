// StoragePort (ADR-0009, docs/06-backend-api.md 10.3): put/get/delete by key. Keys are built by the
// callers from server-side ids only (`tenants/{tenantId}/...`); adapters re-check the shape.

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface StoragePort {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  /** Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
}

/** Only these key shapes exist: public tenant content and private artefacts, lower-case, no dots path. */
export const STORAGE_KEY = /^(tenants|private)\/[0-9a-f-]{36}(\/[a-z0-9-]+)+\.(webp|png|zip)$/;
