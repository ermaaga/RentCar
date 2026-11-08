import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Email outbox (5.15) and job runs (5.16): constraints and idempotency.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });

async function tenant(): Promise<string> {
  const id = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Outbox')", [
    id,
    `ob-${id.slice(0, 8)}`,
  ]);
  return id;
}

async function removeTenant(id: string): Promise<void> {
  await admin.query("DELETE FROM email_log WHERE tenant_id = $1", [id]);
  await admin.query("DELETE FROM job_runs WHERE tenant_id = $1", [id]);
  await admin.query("DELETE FROM tenants WHERE id = $1", [id]);
}

describe.skipIf(!adminUrl)("email outbox", () => {
  it("never allows automatic retries for credential emails", async () => {
    const t = await tenant();
    try {
      await expect(
        admin.query(
          `INSERT INTO email_log (id, tenant_id, channel, category, template, related_type, related_id, max_attempts)
           VALUES ($1, $2, 'system_smtp', 'credential', 'activation', 'user', $3, 3)`,
          [randomUUID(), t, randomUUID()],
        ),
      ).rejects.toThrow();
    } finally {
      await removeTenant(t);
    }
  });

  it("accepts a transactional email with retries and rejects an unknown status", async () => {
    const t = await tenant();
    try {
      await admin.query(
        `INSERT INTO email_log (id, tenant_id, channel, category, template, related_type, related_id)
         VALUES ($1, $2, 'tenant_smtp', 'transactional', 'booking-confirmed', 'booking', $3)`,
        [randomUUID(), t, randomUUID()],
      );
      await expect(
        admin.query(
          `INSERT INTO email_log (id, tenant_id, channel, category, template, related_type, related_id, status)
           VALUES ($1, $2, 'tenant_smtp', 'transactional', 'x', 'booking', $3, 'lost')`,
          [randomUUID(), t, randomUUID()],
        ),
      ).rejects.toThrow();
    } finally {
      await removeTenant(t);
    }
  });
});

describe.skipIf(!adminUrl)("job runs", () => {
  it("allows one run per job, tenant and period, including platform jobs", async () => {
    const t = await tenant();
    const period = "2026-11-09T10";
    const job = `job-${randomUUID().slice(0, 8)}`;
    const insert = `INSERT INTO job_runs (id, job, tenant_id, period_key, status, started_at, finished_at)
                    VALUES ($1, $2, $3, $4, 'succeeded', now(), now())`;
    try {
      await admin.query(insert, [randomUUID(), job, t, period]);
      await expect(admin.query(insert, [randomUUID(), job, t, period])).rejects.toThrow();
      await admin.query(insert, [randomUUID(), job, null, period]);
      await expect(admin.query(insert, [randomUUID(), job, null, period])).rejects.toThrow();
    } finally {
      await removeTenant(t);
      await admin.query("DELETE FROM job_runs WHERE job = $1", [job]);
    }
  });
});
