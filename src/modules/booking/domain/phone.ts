// Customer phone numbers (docs/05-database.md 5.11, FR-PUB-06): stored in E.164 so the same person
// matches the same customer row. Pure. Spaces, dots, dashes and brackets are ignored; "00" is read as
// "+". A number without an international prefix takes the tenant's calling code when it is known.

const E164 = /^\+[1-9][0-9]{6,14}$/;

/** Calling codes of the countries the product launches in (spec section 10); others must type "+". */
const CALLING_CODES: Readonly<Record<string, string>> = {
  IT: "39",
  SM: "378",
  VA: "39",
  CH: "41",
  FR: "33",
  DE: "49",
  AT: "43",
  ES: "34",
  GB: "44",
  AL: "355",
};

export function normalizePhone(input: string, countryCode?: string): string | null {
  const compact = input.trim().replace(/[\s.\-()/]/g, "");
  let candidate = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  if (!candidate.startsWith("+")) {
    const calling = countryCode ? CALLING_CODES[countryCode.toUpperCase()] : undefined;
    if (!calling) return null;
    // Italy keeps the leading 0 of landlines in E.164; elsewhere it is a trunk prefix and is dropped.
    const national = calling === "39" ? candidate : candidate.replace(/^0/, "");
    candidate = `+${calling}${national}`;
  }
  return E164.test(candidate) ? candidate : null;
}
