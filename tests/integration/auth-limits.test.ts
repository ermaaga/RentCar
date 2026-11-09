import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type * as AuthActions from "../../src/app/actions/auth";

// Entry-point limits and events (docs/06-backend-api.md 3.9 RL-05/RL-08, 11.2) through the real server
// actions; only the request context (headers, cookies) is replaced. Each test uses its own client IP.
const request = vi.hoisted(() => ({ ip: "192.0.2.1" }));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-forwarded-for": request.ip })),
  cookies: () =>
    Promise.resolve({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
let actions: typeof AuthActions;
let admin: pg.Pool;

beforeAll(async () => {
  Object.assign(process.env, {
    APP_ENV: "ci",
    DATABASE_URL: appUrl,
    CRON_SECRET: "c".repeat(40),
    APP_ENCRYPTION_KEY: "e".repeat(40),
    PASSWORD_PEPPER: "p".repeat(40),
  });
  admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
  actions = await import("../../src/app/actions/auth");
});

afterAll(async () => {
  await admin.end();
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

function useFreshIp(): string {
  const n = 1 + Math.floor(Math.random() * 250);
  request.ip = `100.${String(64 + (n % 60))}.${String(n)}.${String(1 + Math.floor(Math.random() * 250))}`;
  return request.ip;
}

async function eventsFrom(ip: string, event: string): Promise<string[]> {
  const prefix = `${ip.split(".").slice(0, 3).join(".")}.0/24`;
  const res = await admin.query<{ reason_code: string | null }>(
    "SELECT reason_code FROM security_event WHERE ip_prefix = $1 AND event = $2",
    [prefix, event],
  );
  return res.rows.map((r) => r.reason_code ?? "");
}

const idle = { status: "idle" } as const;

describe.skipIf(!appUrl || !adminUrl)("system sign-in per-IP limit (RL-05)", () => {
  it("refuses the 11th attempt from one IP after 10 failures, across usernames", async () => {
    const ip = useFreshIp();
    for (let i = 0; i < 10; i += 1) {
      const user = `nobody-${randomUUID().slice(0, 8)}`;
      const res = await actions.loginSystemAction(idle, form({ username: user, password: "x" }));
      expect(res).toEqual({ status: "error", messageKey: "auth.login.invalid" });
    }
    const last = await actions.loginSystemAction(
      idle,
      form({ username: "someone", password: "x" }),
    );
    expect(last).toEqual({ status: "error", messageKey: "auth.login.throttled" });
    expect(await eventsFrom(ip, "auth.login.failure")).toHaveLength(10);
    expect(await eventsFrom(ip, "auth.login.throttled")).toEqual(["ip"]);
    expect(await eventsFrom(ip, "ratelimit.exceeded")).toContain("auth.login_failure.ip.system");
  }, 30_000);
});

describe.skipIf(!appUrl || !adminUrl)("set-password per-IP limit (RL-08)", () => {
  it("refuses redemptions after 10 invalid links from one IP", async () => {
    const ip = useFreshIp();
    const attempt = () =>
      actions.redeemSystemAction(
        idle,
        form({
          token: randomUUID(),
          password: "long enough passphrase",
          confirm: "long enough passphrase",
        }),
      );
    for (let i = 0; i < 10; i += 1) {
      expect(await attempt()).toEqual({ status: "error", messageKey: "auth.setPassword.invalid" });
    }
    expect(await attempt()).toEqual({ status: "error", messageKey: "auth.login.throttled" });
    expect(await eventsFrom(ip, "auth.token.rejected")).toHaveLength(10);
  }, 30_000);
});
