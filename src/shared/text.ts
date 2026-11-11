import { z } from "zod";

// Single-line text input rules (docs/08-security.md SR-VAL-04): Unicode NFC, trimmed, and no control
// characters, line or paragraph separators, or bidi overrides and isolates (U+202A-202E,
// U+2066-2069). Output escaping stays with JSX and the email and PDF renderers. Pure.

/** True when the value holds a character that single-line text must not contain. */
export function hasControl(value: string): boolean {
  return Array.from(value).some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    const bidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    return (
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || bidi
    );
  });
}

/** Zod schema for a single-line text field of `min` to `max` characters (after trim and NFC). */
export const singleLineText = (min: number, max: number) =>
  z
    .string()
    .transform((v) => v.normalize("NFC").trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine((v) => !hasControl(v), "control characters are not allowed"),
    );
