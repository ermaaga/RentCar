import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Traceability of the M0 abuse cases (docs/08-security.md section 6). Each case is:
//  - automated: covered by a test or gate that exists today (evidence file listed)
//  - partial:   part of the case is covered now; the rest is listed in `gap`
//  - pending:   needs a later milestone (the data layer, the logging module, the route registry)
type Status = "automated" | "partial" | "pending";
interface AbuseCase {
  id: string;
  status: Status;
  evidence: string[];
  gap?: string;
}

export const M0_ABUSE_CASES: AbuseCase[] = [
  { id: "ABU-M0-01", status: "automated", evidence: ["tests/integration/database.test.ts"] },
  {
    id: "ABU-M0-02",
    status: "pending",
    evidence: [],
    gap: "no tenant tables before M1 (RLS policies)",
  },
  { id: "ABU-M0-03", status: "pending", evidence: [], gap: "no tenant tables before M1" },
  { id: "ABU-M0-04", status: "pending", evidence: [], gap: "tenant context and pooler (spike S1)" },
  {
    id: "ABU-M0-05",
    status: "pending",
    evidence: [],
    gap: "spike S1 with real transaction pooler",
  },
  {
    id: "ABU-M0-06",
    status: "pending",
    evidence: [],
    gap: "rule for set_config/SET app.* not written yet",
  },
  {
    id: "ABU-M0-07",
    status: "pending",
    evidence: [],
    gap: "audit_log tables arrive with the audit module",
  },
  {
    id: "ABU-M0-08",
    status: "pending",
    evidence: [],
    gap: "grant allowlist snapshot needs the full schema",
  },
  {
    id: "ABU-M0-09",
    status: "partial",
    evidence: ["tests/unit/config.test.ts"],
    gap: "seed guard, STORAGE_PROVIDER and RATE_LIMIT guards not in the config yet",
  },
  {
    id: "ABU-M0-10",
    status: "automated",
    evidence: ["scripts/security/gitleaks-selftest.sh", ".gitleaks.toml"],
  },
  {
    id: "ABU-M0-11",
    status: "partial",
    evidence: ["tests/e2e/home.spec.ts"],
    gap: "only the public page and API classes exist; /system, /media, PDF and CSV are later",
  },
  { id: "ABU-M0-12", status: "pending", evidence: [], gap: "no middleware yet" },
  {
    id: "ABU-M0-13",
    status: "pending",
    evidence: [],
    gap: "route registry arrives with defineRoute/defineAction",
  },
  {
    id: "ABU-M0-14",
    status: "automated",
    evidence: ["scripts/security/semgrep-selftest.sh", ".dependency-cruiser.cjs"],
  },
  { id: "ABU-M0-15", status: "pending", evidence: [], gap: "log canary needs the logging module" },
  {
    id: "ABU-M0-16",
    status: "partial",
    evidence: [".github/workflows/security.yml"],
    gap: "failing-then-passing run on a throwaway branch is pending the first CI run on GitHub",
  },
];

describe("M0 abuse-case traceability", () => {
  it("covers every M0 case exactly once", () => {
    const ids = M0_ABUSE_CASES.map((c) => c.id);
    const expected = Array.from(
      { length: 16 },
      (_, i) => `ABU-M0-${String(i + 1).padStart(2, "0")}`,
    );
    expect(ids).toEqual(expected);
  });

  it("points automated and partial cases at evidence that exists", () => {
    for (const c of M0_ABUSE_CASES.filter((x) => x.status !== "pending")) {
      expect(c.evidence.length, c.id).toBeGreaterThan(0);
      for (const file of c.evidence) {
        expect(existsSync(resolve(__dirname, "../..", file)), `${c.id}: ${file}`).toBe(true);
      }
    }
  });

  it("states the gap for every case that is not fully automated", () => {
    for (const c of M0_ABUSE_CASES.filter((x) => x.status !== "automated")) {
      expect(c.gap, c.id).toBeTruthy();
    }
  });
});
