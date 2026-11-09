import { describe, expect, it } from "vitest";

import {
  credentialExpiry,
  credentialState,
  startsSession,
} from "../../src/modules/auth/domain/credential-policy";

const now = new Date("2026-11-09T10:00:00Z");

describe("credential policy", () => {
  it("gives activation 24 hours and reset 60 minutes", () => {
    expect(credentialExpiry("activation", now).toISOString()).toBe("2026-11-10T10:00:00.000Z");
    expect(credentialExpiry("password_reset", now).toISOString()).toBe("2026-11-09T11:00:00.000Z");
  });

  it("reads superseded as invalid, then used, then expiry", () => {
    const later = new Date(now.getTime() + 1);
    expect(credentialState(undefined, now)).toBe("invalid");
    expect(credentialState({ expiresAt: later, usedAt: null, supersededAt: now }, now)).toBe(
      "invalid",
    );
    expect(credentialState({ expiresAt: later, usedAt: now, supersededAt: null }, now)).toBe(
      "used",
    );
    expect(credentialState({ expiresAt: now, usedAt: null, supersededAt: null }, now)).toBe(
      "expired",
    );
    expect(credentialState({ expiresAt: later, usedAt: null, supersededAt: null }, now)).toBe(
      "valid",
    );
  });

  it("starts a session only on activation", () => {
    expect(startsSession("activation")).toBe(true);
    expect(startsSession("password_reset")).toBe(false);
  });
});
