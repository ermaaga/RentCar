import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { recordSecurityEvent } from "../../src/platform/security-events/recorder";

// security_event as the runtime role (05-database 5.19, 06-backend-api 11.2).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
const app = new pg.Pool({ connectionString: appUrl, max: 2 });
const KEY = Buffer.alloc(32, 3);

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe.skipIf(!adminUrl || !appUrl)("recordSecurityEvent", () => {
  it("stores codes, a network prefix and an HMAC, never the address itself", async () => {
    const actor = randomUUID();
    const res = await recordSecurityEvent(
      app,
      KEY,
      {
        event: "auth.login.failure",
        realm: "tenant",
        outcome: "failure",
        reasonCode: "bad_password",
        actorId: actor,
        ip: "198.51.100.23",
      },
      new Date(),
    );
    expect(res.ok).toBe(true);
    const row = await admin.query<Record<string, string>>(
      "SELECT * FROM security_event WHERE actor_id = $1",
      [actor],
    );
    expect(row.rows[0]).toMatchObject({
      event: "auth.login.failure",
      reason_code: "bad_password",
      ip_prefix: "198.51.100.0/24",
    });
    expect(row.rows[0]?.ip_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row.rows[0])).not.toContain("198.51.100.23");
  });

  it("reports a rejected row instead of throwing", async () => {
    const res = await recordSecurityEvent(
      app,
      KEY,
      { event: "", realm: "tenant", outcome: "failure" },
      new Date(),
    );
    expect(res.ok).toBe(false);
  });
});
