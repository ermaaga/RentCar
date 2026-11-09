import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Traceability of the M1 abuse cases (docs/08-security.md section 6, M1 quality loop). Same rules as
// the M0 table: automated = covered today; partial = what is missing is in `gap`; pending = needs
// code that does not exist yet (a later milestone or a host).
type Status = "automated" | "partial" | "pending";
interface AbuseCase {
  id: string;
  status: Status;
  evidence: string[];
  gap?: string;
}

const I = (name: string) => `tests/integration/${name}.test.ts`;
const U = (name: string) => `tests/unit/${name}.test.ts`;
const E2E = "tests/e2e/onboarding.spec.ts";

export const M1_ABUSE_CASES: AbuseCase[] = [
  {
    id: "ABU-M1-01",
    status: "partial",
    evidence: [
      I("access-matrix"),
      "tests/security/route-registry.test.ts",
      I("jobs-endpoint"),
      E2E,
    ],
    gap: "actions and the job route by behaviour; pages only by a static guard check",
  },
  {
    id: "ABU-M1-02",
    status: "partial",
    evidence: [I("access-matrix"), "tests/security/route-registry.test.ts"],
    gap: "all protected actions by behaviour (operator, other tenant, tenant admin on /system); pages statically",
  },
  {
    id: "ABU-M1-03",
    status: "partial",
    evidence: [I("system-realm"), I("tenancy")],
    gap: "no tenant.mismatch security event yet",
  },
  {
    id: "ABU-M1-04",
    status: "partial",
    evidence: [I("sessions"), I("auth-limits")],
    gap: "same message checked; header equality and one argon2 verify per path not asserted",
  },
  { id: "ABU-M1-05", status: "automated", evidence: [I("sessions"), I("auth-limits")] },
  { id: "ABU-M1-06", status: "automated", evidence: [U("client-ip"), U("config")] },
  {
    id: "ABU-M1-07",
    status: "pending",
    evidence: [],
    gap: "rate-limit store outage behaviour not tested",
  },
  {
    id: "ABU-M1-08",
    status: "pending",
    evidence: [],
    gap: "cookie attributes not asserted by an E2E test (needs https host)",
  },
  {
    id: "ABU-M1-09",
    status: "partial",
    evidence: [I("sessions")],
    gap: "new token per login and hash-only storage tested; pre-login cookie replay not tested",
  },
  { id: "ABU-M1-10", status: "automated", evidence: [I("sessions"), I("system-realm")] },
  {
    id: "ABU-M1-11",
    status: "partial",
    evidence: [I("tenant-lifecycle"), I("change-password"), I("operators"), I("sessions")],
    gap: "admin replace (AUT-18) not built yet",
  },
  { id: "ABU-M1-12", status: "automated", evidence: [I("credential-links")] },
  { id: "ABU-M1-13", status: "automated", evidence: [I("credential-links")] },
  {
    id: "ABU-M1-14",
    status: "partial",
    evidence: [U("password-policy")],
    gap: "common-password list and equals-username rule not implemented",
  },
  {
    id: "ABU-M1-15",
    status: "partial",
    evidence: [I("password-reset"), E2E],
    gap: "forged Host header case not asserted (links are built from APP_BASE_URL only)",
  },
  {
    id: "ABU-M1-16",
    status: "partial",
    evidence: [U("tenancy-input")],
    gap: "operator actions read named fields only; no explicit unknown-key test for them",
  },
  {
    id: "ABU-M1-17",
    status: "pending",
    evidence: [],
    gap: "cross-origin server action test not written (Next.js origin check relied on)",
  },
  {
    id: "ABU-M1-18",
    status: "pending",
    evidence: [],
    gap: "no next/returnTo parameter exists yet; add the test when one does",
  },
  { id: "ABU-M1-19", status: "automated", evidence: [U("smtp-target"), U("smtp-host-guard")] },
  { id: "ABU-M1-20", status: "automated", evidence: [U("smtp-target")] },
  {
    id: "ABU-M1-21",
    status: "partial",
    evidence: [U("smtp-target"), U("smtp-host-guard")],
    gap: "bad certificate and stripped STARTTLS need a fake TLS server",
  },
  {
    id: "ABU-M1-22",
    status: "partial",
    evidence: [I("smtp-settings")],
    gap: "categories stored only; no fake server returning a secret banner",
  },
  { id: "ABU-M1-23", status: "automated", evidence: [U("config")] },
  {
    id: "ABU-M1-24",
    status: "partial",
    evidence: [I("smtp-settings"), U("encryptor")],
    gap: "RSC payload and log inspection not automated",
  },
  { id: "ABU-M1-25", status: "pending", evidence: [], gap: "key rotation command not built" },
  { id: "ABU-M1-26", status: "automated", evidence: [I("jobs-endpoint"), I("jobs"), U("config")] },
  { id: "ABU-M1-27", status: "automated", evidence: [U("jobs")] },
  {
    id: "ABU-M1-28",
    status: "pending",
    evidence: [],
    gap: "booking, customer, vehicle and expense tables arrive in M2-M4",
  },
  {
    id: "ABU-M1-29",
    status: "partial",
    evidence: [U("seed")],
    gap: "password-not-logged check not automated",
  },
  {
    id: "ABU-M1-30",
    status: "partial",
    evidence: [I("tenant-lifecycle"), I("credential-links")],
    gap: "public page, theme, media and PDF arrive in M2",
  },
  {
    id: "ABU-M1-31",
    status: "partial",
    evidence: [U("tenancy-input"), I("tenancy")],
    gap: "tombstoned slug and homoglyph cases not asserted",
  },
  {
    id: "ABU-M1-32",
    status: "partial",
    evidence: [I("tenant-lifecycle")],
    gap: "reset covered (sessions, notice, audit); replace admin (AUT-18) not built",
  },
  { id: "ABU-M1-33", status: "pending", evidence: [], gap: "load test needs a host" },
  {
    id: "ABU-M1-34",
    status: "partial",
    evidence: [I("change-password"), I("outbox"), I("tenant-lifecycle")],
    gap: "session list and sign-out-others (AUT-09/10) not built",
  },
  {
    id: "ABU-M1-35",
    status: "partial",
    evidence: [U("password-hash")],
    gap: "rehash on login and bulk reissue command not built",
  },
];

describe("M1 abuse-case traceability", () => {
  it("covers every M1 case exactly once", () => {
    const ids = M1_ABUSE_CASES.map((c) => c.id);
    const expected = Array.from(
      { length: 35 },
      (_, i) => `ABU-M1-${String(i + 1).padStart(2, "0")}`,
    );
    expect(ids).toEqual(expected);
  });

  it("points automated and partial cases at evidence that exists", () => {
    for (const c of M1_ABUSE_CASES.filter((x) => x.status !== "pending")) {
      expect(c.evidence.length, c.id).toBeGreaterThan(0);
      for (const file of c.evidence) {
        expect(existsSync(resolve(__dirname, "../..", file)), `${c.id}: ${file}`).toBe(true);
      }
    }
  });

  it("states the gap for every case that is not fully automated", () => {
    for (const c of M1_ABUSE_CASES.filter((x) => x.status !== "automated")) {
      expect(c.gap, c.id).toBeTruthy();
    }
  });
});
