import { randomUUID } from "node:crypto";
import type pg from "pg";

import { withSystemTx } from "../../../platform/db/system-tx";

// Console lifecycle (docs/06-backend-api.md TEN-05, TEN-06, TEN-10, SUB-02). System scope only; each
// change writes one platform_audit row in the same transaction.

export interface ConsoleContext {
  actorUserId: string;
  now: Date;
}

interface AuditEntry {
  action: string;
  tenantId: string;
  changes?: Record<string, unknown>;
}

async function audit(c: pg.ClientBase, ctx: ConsoleContext, entry: AuditEntry): Promise<void> {
  await c.query(
    `INSERT INTO platform_audit (id, created_at, actor_user_id, action, subject_tenant_id, changes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      ctx.now,
      ctx.actorUserId,
      entry.action,
      entry.tenantId,
      JSON.stringify(entry.changes ?? {}),
    ],
  );
}

export type StatusChange = "suspended" | "active";

/**
 * Suspends or reactivates a tenant. Suspension deletes every tenant session, so the effect is
 * immediate. Repeating the current state is a no-op that still answers ok (06-backend-api 3.8).
 */
export async function setTenantStatus(
  pool: pg.Pool,
  input: { slug: string; to: StatusChange },
  ctx: ConsoleContext,
): Promise<{ ok: true; changed: boolean } | { ok: false; code: "NOT_FOUND" }> {
  return withSystemTx(pool, async (c) => {
    const found = await c.query<{ id: string; status: string }>(
      "SELECT id, status FROM tenants WHERE slug = $1 AND status IN ('active', 'suspended') FOR UPDATE",
      [input.slug],
    );
    const tenant = found.rows[0];
    if (!tenant) {
      return { ok: false, code: "NOT_FOUND" };
    }
    if (tenant.status === input.to) {
      return { ok: true, changed: false };
    }
    await c.query("UPDATE tenants SET status = $2, updated_at = $3 WHERE id = $1", [
      tenant.id,
      input.to,
      ctx.now,
    ]);
    if (input.to === "suspended") {
      await c.query("DELETE FROM sessions WHERE tenant_id = $1", [tenant.id]);
    }
    await audit(c, ctx, {
      action: input.to === "suspended" ? "tenant.suspended" : "tenant.reactivated",
      tenantId: tenant.id,
    });
    return { ok: true, changed: true };
  });
}

/** SUB-02 renewal: moves the end date of a non-cancelled subscription (never before its start). */
export async function changeSubscriptionEnd(
  pool: pg.Pool,
  input: { slug: string; subscriptionId: string; endDate: string },
  ctx: ConsoleContext,
): Promise<
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "SUBSCRIPTION_INVALID_PERIOD" | "SUBSCRIPTION_OVERLAP" }
> {
  try {
    return await withSystemTx(pool, async (c) => {
      const res = await c.query<{ tenant_id: string }>(
        `UPDATE subscriptions s SET end_date = $3
           FROM tenants t
          WHERE s.id = $2 AND s.tenant_id = t.id AND t.slug = $1 AND s.status <> 'cancelled'
          RETURNING s.tenant_id`,
        [input.slug, input.subscriptionId, input.endDate],
      );
      const row = res.rows[0];
      if (!row) {
        return { ok: false, code: "NOT_FOUND" };
      }
      await audit(c, ctx, {
        action: "subscription.renewed",
        tenantId: row.tenant_id,
        changes: { endDate: input.endDate },
      });
      return { ok: true };
    });
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "23514") return { ok: false, code: "SUBSCRIPTION_INVALID_PERIOD" };
    if (e.code === "23P01") return { ok: false, code: "SUBSCRIPTION_OVERLAP" };
    throw err;
  }
}

export interface TenantDetail {
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  title: string | null;
  contactEmail: string | null;
  admin: { username: string; email: string; displayName: string; status: string } | null;
  subscriptions: {
    id: string;
    startDate: string;
    endDate: string;
    status: string;
    maxVehicles: number;
    maxOperators: number;
  }[];
}

/** TEN-10 (subset): tenant, public contact, admin account state and subscription history. */
export async function getTenantDetail(pool: pg.Pool, slug: string): Promise<TenantDetail | null> {
  return withSystemTx(pool, async (c) => {
    const t = await c.query<Omit<TenantDetail, "admin" | "subscriptions">>(
      `SELECT t.id AS "tenantId", t.slug, t.name, t.status, s.title, s.contact_email AS "contactEmail"
         FROM tenants t LEFT JOIN tenant_settings s ON s.tenant_id = t.id
        WHERE t.slug = $1 AND t.status <> 'deleted'`,
      [slug],
    );
    const tenant = t.rows[0];
    if (!tenant) {
      return null;
    }
    const admin = await c.query<NonNullable<TenantDetail["admin"]>>(
      `SELECT username, email, display_name AS "displayName", status FROM users
        WHERE tenant_id = $1 AND role = 'admin' AND status IN ('pending', 'active')`,
      [tenant.tenantId],
    );
    const subs = await c.query<TenantDetail["subscriptions"][number]>(
      `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(end_date, 'YYYY-MM-DD') AS "endDate",
              status, max_vehicles AS "maxVehicles", max_operators AS "maxOperators"
         FROM subscriptions WHERE tenant_id = $1 ORDER BY start_date DESC`,
      [tenant.tenantId],
    );
    return { ...tenant, admin: admin.rows[0] ?? null, subscriptions: subs.rows };
  });
}
