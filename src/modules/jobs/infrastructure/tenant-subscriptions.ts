import type pg from "pg";

import { getEffectiveAccess, localDate } from "../../subscriptions";
import type { TenantTarget } from "./job-types";

// The tenant's live subscriptions, newest end first, with the derived access state and the tenant's
// local "today": the one read both subscription jobs start from (06-backend-api 4.4, 8.2).

export interface SubscriptionRow {
  id: string;
  start_date: string;
  end_date: string;
  status: "active" | "cancelled";
}

export async function subscriptionState(c: pg.ClientBase, now: Date, tenant: TenantTarget) {
  const res = await c.query<SubscriptionRow>(
    `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start_date,
            to_char(end_date, 'YYYY-MM-DD') AS end_date, status
       FROM subscriptions WHERE tenant_id = $1 AND status <> 'cancelled' ORDER BY end_date DESC`,
    [tenant.id],
  );
  const periods = res.rows.map((r) => ({
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
  }));
  return {
    rows: res.rows,
    access: getEffectiveAccess(tenant, periods, now),
    today: localDate(now, tenant.timeZone),
  };
}
