import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Traceability of the M2 abuse cases (docs/08-security.md section 6, M2 quality loop). Same rules as
// M0 and M1: automated = covered today; partial = what is missing is in `gap`; pending = needs code
// that does not exist yet (a later milestone or a host).
type Status = "automated" | "partial" | "pending";
interface AbuseCase {
  id: string;
  status: Status;
  evidence: string[];
  gap?: string;
}

const I = (name: string) => `tests/integration/${name}.test.ts`;
const U = (name: string) => `tests/unit/${name}.test.ts`;
const E = (name: string) => `tests/e2e/${name}.spec.ts`;

export const M2_ABUSE_CASES: AbuseCase[] = [
  {
    id: "ABU-M2-01",
    status: "partial",
    evidence: [I("public-booking"), I("auth-limits"), U("throttle-policy")],
    gap: "phone cap and the shared limiter are tested; RL-01/RL-02 not exercised through the public entry points",
  },
  {
    id: "ABU-M2-02",
    status: "partial",
    evidence: [I("public-booking")],
    gap: "search fails open and submit fails closed in code; neither path is driven with the store down",
  },
  {
    id: "ABU-M2-03",
    status: "partial",
    evidence: [U("public-booking")],
    gap: "token checks are unit-tested; the decoy answer of the action is not exercised end to end",
  },
  { id: "ABU-M2-04", status: "automated", evidence: [U("public-booking")] },
  {
    id: "ABU-M2-05",
    status: "automated",
    evidence: [U("public-booking"), U("shared-text"), U("vehicle-input")],
  },
  {
    id: "ABU-M2-06",
    status: "partial",
    evidence: [U("booking-email"), "tests/security/semgrep-fixtures"],
    gap: "no payload run across confirmation, email HTML and PDF; relies on JSX, escapeHtml and the Semgrep ban; calendar and CSV come in M3/M4",
  },
  { id: "ABU-M2-07", status: "automated", evidence: [I("public-booking")] },
  {
    id: "ABU-M2-08",
    status: "partial",
    evidence: [I("public-booking")],
    gap: "sequential replay tested; three parallel replays not",
  },
  {
    id: "ABU-M2-09",
    status: "automated",
    evidence: [U("booking-email"), I("booking-documents"), U("shared-text")],
  },
  {
    id: "ABU-M2-10",
    status: "automated",
    evidence: [I("credential-links"), I("operators"), I("outbox")],
  },
  {
    id: "ABU-M2-11",
    status: "partial",
    evidence: [I("booking-documents"), E("seo")],
    gap: "tenant-bound lookup tested; identical 404s, the 429 after 10 misses and the route headers are not asserted",
  },
  {
    id: "ABU-M2-12",
    status: "partial",
    evidence: [I("booking-documents")],
    gap: "PDF renders without network today; the tenant logo in the PDF arrives in M5",
  },
  {
    id: "ABU-M2-13",
    status: "partial",
    evidence: [U("booking-domain"), I("public-booking")],
    gap: "alphabet and length tested; the 1,000,000-code collision run is not automated",
  },
  {
    id: "ABU-M2-14",
    status: "partial",
    evidence: [U("media-pipeline"), I("vehicle-photos"), I("access-matrix"), E("photos")],
    gap: "vehicle photos covered; logo upload arrives in M5",
  },
  { id: "ABU-M2-15", status: "automated", evidence: [U("media-pipeline"), I("vehicle-photos")] },
  {
    id: "ABU-M2-16",
    status: "partial",
    evidence: [U("media-pipeline"), E("photos")],
    gap: "storage keys and a private path are tested; encoded traversal variants not driven against the route",
  },
  { id: "ABU-M2-17", status: "pending", evidence: [], gap: "needs the s3 adapter and a host" },
  {
    id: "ABU-M2-18",
    status: "partial",
    evidence: [I("vehicles"), I("vehicle-photos"), I("availability"), I("access-matrix")],
    gap: "expenses arrive in M4",
  },
  {
    id: "ABU-M2-19",
    status: "automated",
    evidence: [I("booking-exclusion"), I("public-booking")],
  },
  {
    id: "ABU-M2-20",
    status: "partial",
    evidence: [U("effective-access"), I("subscriptions")],
    gap: "the access rule is tested; a stale form submitted to the action needs a request context",
  },
  {
    id: "ABU-M2-21",
    status: "automated",
    evidence: [U("booking-search"), U("booking-domain"), I("availability")],
  },
  { id: "ABU-M2-22", status: "automated", evidence: [U("vehicle-input")] },
];

describe("M2 abuse-case traceability", () => {
  it("covers every M2 case exactly once", () => {
    const ids = M2_ABUSE_CASES.map((c) => c.id);
    const expected = Array.from(
      { length: 22 },
      (_, i) => `ABU-M2-${String(i + 1).padStart(2, "0")}`,
    );
    expect(ids).toEqual(expected);
  });

  it("points automated and partial cases at evidence that exists", () => {
    for (const c of M2_ABUSE_CASES.filter((x) => x.status !== "pending")) {
      expect(c.evidence.length, c.id).toBeGreaterThan(0);
      for (const file of c.evidence) {
        expect(existsSync(resolve(__dirname, "../..", file)), `${c.id}: ${file}`).toBe(true);
      }
    }
  });

  it("states the gap for every case that is not fully automated", () => {
    for (const c of M2_ABUSE_CASES.filter((x) => x.status !== "automated")) {
      expect(c.gap, c.id).toBeTruthy();
    }
  });
});
