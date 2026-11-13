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

/** Like hasControl, but line breaks are allowed (notes, A-23 textareas). */
function hasControlExceptNewline(value: string): boolean {
  return hasControl(value.replace(/\r?\n/g, " "));
}

/**
 * 13 to 19 digits, possibly separated by spaces or dashes: treated as a card number (SR-VAL-11,
 * FR-DAT-01). Stricter than a Luhn check on purpose; short numbers such as a mileage pass.
 */
export function looksLikeCardNumber(value: string): boolean {
  return /(?:\d[ -]?){13,19}/.test(value);
}

/** Zod schema for an optional notes field: NFC, trimmed, line breaks kept, no card numbers. */
export const notesText = (max: number) =>
  z
    .string()
    .transform((v) => v.normalize("NFC").replace(/\r\n/g, "\n").trim())
    .pipe(
      z
        .string()
        .max(max)
        .refine((v) => !hasControlExceptNewline(v), "control characters are not allowed")
        .refine((v) => !looksLikeCardNumber(v), "card numbers are not allowed"),
    );
