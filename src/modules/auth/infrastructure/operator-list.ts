import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";

// AUT-16 listOperators (docs/06-backend-api.md, W-D9): the tenant's operators with "Activation not
// delivered" derived from the latest credential email_log row (8.3): failed, or pending for 15 min.

type OperatorStatus = "pending" | "active" | "deactivated" | "activation_not_delivered";

export interface OperatorRow {
  id: string;
  username: string;
  displayName: string;
  email: string;
  status: OperatorStatus;
}

const UNDELIVERED_AFTER_MS = 15 * 60_000;

interface ListRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  status: "pending" | "active" | "deactivated";
  mail_status: string | null;
  mail_created_at: Date | null;
}

function derivedStatus(row: ListRow, now: Date): OperatorStatus {
  if (row.status !== "pending" || !row.mail_status) {
    return row.status;
  }
  const stale =
    row.mail_status === "pending" &&
    now.getTime() - (row.mail_created_at?.getTime() ?? 0) > UNDELIVERED_AFTER_MS;
  return row.mail_status === "failed" || stale ? "activation_not_delivered" : "pending";
}

/** AUT-16: operators of the tenant with "Activation not delivered" derived from email_log (8.3). */
export async function listOperators(
  pool: pg.Pool,
  tenantId: string,
  now: Date,
): Promise<OperatorRow[]> {
  const res = await withTenantTx(pool, tenantId, (c) =>
    c.query<ListRow>(
      `SELECT u.id, u.username, u.display_name, u.email, u.status,
              m.status AS mail_status, m.created_at AS mail_created_at
         FROM users u
         LEFT JOIN LATERAL (
           SELECT status, created_at FROM email_log
            WHERE tenant_id = u.tenant_id AND related_type = 'user' AND related_id = u.id
              AND category = 'credential'
            ORDER BY created_at DESC LIMIT 1
         ) m ON true
        WHERE u.tenant_id = $1 AND u.role = 'operator'
        ORDER BY (u.status = 'deactivated'), lower(u.display_name), u.id`,
      [tenantId],
    ),
  );
  return res.rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    email: r.email,
    status: derivedStatus(r, now),
  }));
}
