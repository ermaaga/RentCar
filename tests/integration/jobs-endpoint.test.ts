import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as RouteModule from "../../src/app/api/jobs/run/route";

// ABU-M1-26 against the real route handler (docs/08-security.md SR-JOB-01/03): every refusal is the
// same 401, the secret is never taken from the query string or a Vercel header, failed attempts are
// limited per IP, and parallel valid calls produce one set of effects.
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const SECRET = "jobs-endpoint-test-secret-0123456789";

type Route = typeof RouteModule;
let route: Route;
let admin: pg.Pool;

beforeAll(async () => {
  Object.assign(process.env, {
    APP_ENV: "ci",
    DATABASE_URL: appUrl,
    CRON_SECRET: SECRET,
    APP_ENCRYPTION_KEY: "e".repeat(40),
    PASSWORD_PEPPER: "p".repeat(40),
  });
  admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
  route = await import("../../src/app/api/jobs/run/route");
});

afterAll(async () => {
  await admin.end();
});

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${String(ipCounter)}`;
}

async function request(
  method: "GET" | "POST",
  init: { headers?: Record<string, string>; body?: string; query?: string } = {},
) {
  const req = new NextRequest(`http://localhost/api/jobs/run${init.query ?? ""}`, {
    method,
    headers: { "x-forwarded-for": freshIp(), ...init.headers },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  return method === "GET" ? route.GET(req) : route.POST(req);
}

describe.skipIf(!appUrl || !adminUrl)("POST|GET /api/jobs/run", () => {
  it.each([
    ["no header", {}],
    ["wrong secret", { headers: { authorization: "Bearer wrong" } }],
    ["secret in the query string", { query: `?secret=${SECRET}&token=${SECRET}` }],
    ["Vercel cron header only", { headers: { "x-vercel-cron": "1" } }],
    ["secret as a cookie", { headers: { cookie: `CRON_SECRET=${SECRET}` } }],
  ])("answers 401 with no detail for %s", async (_label, init) => {
    for (const method of ["GET", "POST"] as const) {
      const res = await request(method, init);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    }
  });

  it("runs with the secret over GET and POST and answers counts only", async () => {
    const auth = { authorization: `Bearer ${SECRET}` };
    const get = await request("GET", { headers: auth });
    expect(get.status).toBe(200);
    expect(get.headers.get("cache-control")).toBe("no-store");
    const body = (await get.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["counts", "runId"]);

    const post = await request("POST", {
      headers: auth,
      body: JSON.stringify({ jobs: ["retention_hourly"] }),
    });
    expect(post.status).toBe(200);
  });
});

describe.skipIf(!appUrl || !adminUrl)("POST /api/jobs/run input and concurrency", () => {
  it("rejects an unknown job name with 400", async () => {
    const res = await request("POST", {
      headers: { authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ jobs: ["drop_everything"] }),
    });
    expect(res.status).toBe(400);
  });

  it("gives five parallel valid calls one set of effects", async () => {
    const before = await admin.query<{ n: string }>(
      "SELECT count(*) AS n FROM job_runs WHERE tenant_id IS NULL AND job = 'retention_hourly'",
    );
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request("POST", {
          headers: { authorization: `Bearer ${SECRET}` },
          body: JSON.stringify({ jobs: ["retention_hourly"] }),
        }),
      ),
    );
    const counts = await Promise.all(
      responses.map(async (r) => ((await r.json()) as { counts: { succeeded: number } }).counts),
    );
    const after = await admin.query<{ n: string }>(
      "SELECT count(*) AS n FROM job_runs WHERE tenant_id IS NULL AND job = 'retention_hourly'",
    );
    // At most one new row for this hour (an earlier test in this file may already have claimed it).
    expect(Number(after.rows[0]?.n) - Number(before.rows[0]?.n)).toBeLessThanOrEqual(1);
    expect(counts.reduce((n, c) => n + c.succeeded, 0)).toBeLessThanOrEqual(1);
  });
});

describe.skipIf(!appUrl || !adminUrl)("/api/jobs/run failure limit (RL-13)", () => {
  it("refuses even the right secret from an IP past 10 failures a minute", async () => {
    const ip = "203.0.113.77";
    const call = (authorization: string) =>
      route.POST(
        new NextRequest("http://localhost/api/jobs/run", {
          method: "POST",
          headers: { "x-forwarded-for": ip, authorization },
        }),
      );
    for (let i = 0; i < 10; i += 1) {
      expect((await call("Bearer wrong")).status).toBe(401);
    }
    expect((await call(`Bearer ${SECRET}`)).status).toBe(401);
    const events = await admin.query<{ reason_code: string }>(
      `SELECT reason_code FROM security_event
        WHERE event = 'job.auth_failed' AND ip_prefix = '203.0.113.0/24' AND created_at > now() - interval '1 minute'`,
    );
    expect(events.rows.map((r) => r.reason_code)).toContain("rate_limited");
  });
});
