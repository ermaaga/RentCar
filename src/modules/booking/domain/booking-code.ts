// Booking codes (docs/05-database.md 6.2, SR-VAL-09): 10 Crockford base32 characters = 50 bits.
// Pure: the random bytes are passed in (the generator lives in infrastructure).

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BOOKING_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** 10 bytes -> 10 symbols; 32 is a power of two, so the low 5 bits are unbiased. */
export function codeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 10) throw new Error("need 10 random bytes");
  return Array.from(bytes.subarray(0, 10), (b) => ALPHABET[b & 31] ?? "0").join("");
}

/** User input -> canonical code (Crockford: O->0, I/L->1, separators and case ignored), or null. */
export function normalizeCode(input: string): string | null {
  const canonical = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return BOOKING_CODE.test(canonical) ? canonical : null;
}
