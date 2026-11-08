import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Field encryption (docs/08-security.md SR-CRY-01..04; docs/05-database.md 5.3).
// Format: v1.<kid>.<nonce base64url>.<ciphertext+tag base64url>. AES-256-GCM, 96-bit nonce, 128-bit tag.
// AAD binds the value to its place (for example rc:v1:smtp_password:<tenantId>), so a copied
// ciphertext does not decrypt in another row.

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = /^v1\.([0-9a-f]{8})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

/** Short, public identifier of a key (first 8 hex characters of its SHA-256). Never the key itself. */
export function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function encryptField(plaintext: string, key: Buffer, aad: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `v1.${keyId(key)}.${nonce.toString("base64url")}.${body.toString("base64url")}`;
}

/**
 * Decrypts with the key whose id is in the value. Fails closed: an unknown key id, a wrong AAD,
 * or any modified byte throws, and nothing about the plaintext is returned.
 */
export function decryptField(value: string, keys: readonly Buffer[], aad: string): string {
  const match = FORMAT.exec(value);
  if (!match) {
    throw new Error("encrypted field has an unknown format");
  }
  const [, kid = "", nonceB64 = "", bodyB64 = ""] = match;
  const key = keys.find((k) => keyId(k) === kid);
  if (!key) {
    throw new Error("encrypted field uses an unknown key");
  }
  const body = Buffer.from(bodyB64, "base64url");
  const tag = body.subarray(body.length - TAG_BYTES);
  const ciphertext = body.subarray(0, body.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonceB64, "base64url"), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
