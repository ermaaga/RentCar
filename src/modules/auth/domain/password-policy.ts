// Password policy (OWASP ASVS 4.0.3 level 2, section 2.1; docs/08-security.md, decision: minimum 12).
// Pure function: no I/O, no framework, no clock.

export const PASSWORD_MIN_LENGTH = 12;
// ASVS 2.1.2 requires at least 64; 128 keeps hashing cost bounded.
export const PASSWORD_MAX_LENGTH = 128;

type PasswordProblem = "too_short" | "too_long" | "blank";

type PasswordCheck = { ok: true } | { ok: false; problems: readonly PasswordProblem[] };

/**
 * Checks length only. ASVS 2.1.2: no composition rules (no forced symbols or digits).
 * Length is counted in code points, so a multi-byte character counts as one.
 */
export function checkPassword(password: string): PasswordCheck {
  const problems: PasswordProblem[] = [];
  if (password.trim().length === 0) {
    problems.push("blank");
  }
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) {
    problems.push("too_short");
  }
  if (length > PASSWORD_MAX_LENGTH) {
    problems.push("too_long");
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
