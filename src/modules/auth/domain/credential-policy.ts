// Set-password links (docs/06-backend-api.md 4.2.2): activation lasts 24 hours, reset 60 minutes.
// Pure: time is passed in.

export type CredentialPurpose = "activation" | "password_reset";

const LIFETIME_MS: Record<CredentialPurpose, number> = {
  activation: 24 * 3_600_000,
  password_reset: 60 * 60_000,
};

export function credentialExpiry(purpose: CredentialPurpose, now: Date): Date {
  return new Date(now.getTime() + LIFETIME_MS[purpose]);
}

export type CredentialState = "valid" | "used" | "expired" | "invalid";

export interface CredentialRow {
  expiresAt: Date;
  usedAt: Date | null;
  supersededAt: Date | null;
}

/** State shown by the link page. A superseded link reads as invalid, like an unknown one. */
export function credentialState(row: CredentialRow | undefined, now: Date): CredentialState {
  if (!row || row.supersededAt) {
    return "invalid";
  }
  if (row.usedAt) {
    return "used";
  }
  return row.expiresAt.getTime() > now.getTime() ? "valid" : "expired";
}

/** Activation logs the user in; a reset forces a clean login (06-backend-api 4.2.2). */
export function startsSession(purpose: CredentialPurpose): boolean {
  return purpose === "activation";
}
