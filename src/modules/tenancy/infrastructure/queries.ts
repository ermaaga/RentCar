import type pg from "pg";

import { withSystemTx } from "../../../platform/db/system-tx";
import { checkSlug } from "../domain/slug";

// TEN-01 resolve and TEN-09 list (docs/06-backend-api.md 6.1). Limited columns only.

export interface ResolvedTenantRow {
  tenantId: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "terminated";
}

/** Unknown, reserved, malformed and deleted slugs all give null (the same generic not-found). */
export async function resolveTenantBySlug(
  pool: pg.Pool,
  slug: string,
): Promise<ResolvedTenantRow | null> {
  if (!checkSlug(slug).ok) {
    return null;
  }
  return withSystemTx(pool, async (c) => {
    const res = await c.query<ResolvedTenantRow>(
      `SELECT id AS "tenantId", slug, name, status FROM tenants
        WHERE slug = $1 AND status IN ('active', 'suspended', 'terminated')`,
      [slug],
    );
    return res.rows[0] ?? null;
  });
}

export interface TenantListRow {
  slug: string;
  name: string;
  status: string;
  adminStatus: string | null;
  endDate: string | null;
}

/** Console list, newest first (paging arrives with the full TEN-09). */
export async function listTenants(pool: pg.Pool, limit = 100): Promise<TenantListRow[]> {
  return withSystemTx(pool, async (c) => {
    const res = await c.query<TenantListRow>(
      `SELECT t.slug, t.name, t.status,
              (SELECT u.status FROM users u WHERE u.tenant_id = t.id AND u.role = 'admin'
                 AND u.status IN ('pending', 'active') LIMIT 1) AS "adminStatus",
              (SELECT to_char(max(s.end_date), 'YYYY-MM-DD') FROM subscriptions s
                WHERE s.tenant_id = t.id AND s.status <> 'cancelled') AS "endDate"
         FROM tenants t WHERE t.status <> 'deleted'
        ORDER BY t.created_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows;
  });
}
