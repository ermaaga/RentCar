import { describe, expect, it } from "vitest";

import {
  createOperatorInput,
  credentialPath,
  SYSTEM_REALM,
  tenantRealm,
  updateOperatorInput,
} from "../../src/modules/auth";
import { realmTenantId } from "../../src/modules/auth/domain/realm";
import { extendIdle, newSessionWindow } from "../../src/modules/auth/domain/session-policy";
import { reminderKey } from "../../src/modules/jobs/domain/catalogue";

describe("realms", () => {
  it("carries the tenant id only for the tenant realm", () => {
    expect(realmTenantId(tenantRealm("t-1"))).toBe("t-1");
    expect(realmTenantId(SYSTEM_REALM)).toBeNull();
  });

  it("builds set-password paths per realm and purpose, with the token encoded", () => {
    expect(credentialPath({ kind: "tenant", slug: "rent-roma" }, "activation", "a+b/c")).toBe(
      "/rent-roma/admin/activate?token=a%2Bb%2Fc",
    );
    expect(credentialPath({ kind: "system" }, "password_reset", "t")).toBe(
      "/system/reset-password?token=t",
    );
  });
});

describe("operator inputs (AUT-12/13)", () => {
  const ok = { displayName: " Sara ", username: "Sara.B", email: "sara@example.test" };

  it("trims the name and lowercases the username", () => {
    expect(createOperatorInput.parse(ok)).toEqual({
      displayName: "Sara",
      username: "sara.b",
      email: "sara@example.test",
    });
  });

  it.each([
    [{ username: "ab" }],
    [{ username: "has space" }],
    [{ displayName: "" }],
    [{ displayName: "x\r\ny" }],
    [{ email: "nope" }],
  ])("rejects %j", (patch) => {
    expect(createOperatorInput.safeParse({ ...ok, ...patch }).success).toBe(false);
  });

  it("lets an edit change only name and email", () => {
    const parsed = updateOperatorInput.parse({ ...ok, role: "admin" });
    expect(parsed).toEqual({ displayName: "Sara", email: "sara@example.test" });
  });
});

describe("job keys", () => {
  it("gives one reminder key per subscription end date", () => {
    expect(reminderKey("s1", "2027-01-31")).toBe("sub:s1:2027-01-31");
    expect(reminderKey("s1", "2027-01-31")).not.toBe(reminderKey("s1", "2028-01-31"));
  });
});

describe("session windows (SR-SES-07, ABU-M1-10)", () => {
  const now = new Date("2026-11-09T10:00:00Z");
  const MIN = 60_000;

  it("gives tenant staff 30 min idle and 12 h absolute, the systemadmin 15 min and 8 h", () => {
    const tenant = newSessionWindow(now, "tenant");
    expect(tenant.idleExpiresAt.getTime() - now.getTime()).toBe(30 * MIN);
    expect(tenant.absoluteExpiresAt.getTime() - now.getTime()).toBe(12 * 60 * MIN);
    const system = newSessionWindow(now, "system");
    expect(system.idleExpiresAt.getTime() - now.getTime()).toBe(15 * MIN);
    expect(system.absoluteExpiresAt.getTime() - now.getTime()).toBe(8 * 60 * MIN);
  });

  it("slides the idle window but never past the absolute expiry", () => {
    const window = newSessionWindow(now, "tenant");
    const later = new Date(now.getTime() + 60 * MIN);
    expect(extendIdle(window, later, "tenant").getTime()).toBe(later.getTime() + 30 * MIN);
    const nearEnd = new Date(window.absoluteExpiresAt.getTime() - 5 * MIN);
    expect(extendIdle(window, nearEnd, "tenant")).toEqual(window.absoluteExpiresAt);
  });
});
