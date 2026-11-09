import type pg from "pg";

import { enqueueEmail } from "../../notifications";
import { reminderKey, type JobCounts } from "../domain/catalogue";
import type { JobContext, TenantJob, TenantTarget } from "./job-types";
import { subscriptionState, type SubscriptionRow } from "./tenant-subscriptions";

// subscription_renewal_reminder (docs/06-backend-api.md 8.2, US-017): once per subscription end date,
// from 14 days before the end until the end of the grace period, the owner (system SMTP) and the tenant
// admin (tenant SMTP when configured, else system SMTP, A-10) get a reminder through the outbox.

async function dueSubscription(
  c: pg.ClientBase,
  now: Date,
  tenant: TenantTarget,
): Promise<SubscriptionRow | undefined> {
  const { rows, access, today } = await subscriptionState(c, now, tenant);
  if (access.state !== "renewal_due" && access.state !== "grace") {
    return undefined;
  }
  // renewal_due: the subscription that contains today; grace: the one that just ended.
  return rows.find((r) => r.start_date <= today && today <= r.end_date) ?? rows[0];
}

async function adminTarget(c: pg.ClientBase, tenantId: string) {
  const admin = await c.query<{ email: string }>(
    `SELECT email FROM users WHERE tenant_id = $1 AND role = 'admin' AND status IN ('pending', 'active')`,
    [tenantId],
  );
  const smtp = await c.query("SELECT 1 FROM tenant_smtp_configs WHERE tenant_id = $1", [tenantId]);
  return {
    email: admin.rows[0]?.email,
    channel: (smtp.rowCount ?? 0) > 0 ? ("tenant_smtp" as const) : ("system_smtp" as const),
  };
}

async function enqueueReminders(
  c: pg.ClientBase,
  ctx: JobContext,
  tenant: TenantTarget,
): Promise<JobCounts> {
  const [, subscriptionId = ""] = ctx.periodKey.split(":");
  const base = {
    tenantId: tenant.id,
    related: { type: "subscription", id: subscriptionId },
  } as const;
  let queued = 0;
  if (ctx.mail?.ownerEmail) {
    await enqueueEmail(c, {
      ...base,
      channel: "system_smtp",
      template: "subscription.renewal_reminder_owner",
      recipient: ctx.mail.ownerEmail,
      now: ctx.now,
    });
    queued += 1;
  }
  const admin = await adminTarget(c, tenant.id);
  if (admin.email) {
    await enqueueEmail(c, {
      ...base,
      channel: admin.channel,
      template: "subscription.renewal_reminder_admin",
      recipient: admin.email,
      now: ctx.now,
    });
    queued += 1;
  }
  ctx.emit({
    event: "subscription.renewal_reminder_sent",
    fields: { tenantId: tenant.id, subscriptionId, queued },
  });
  return { processed: 1, changed: queued };
}

export const renewalReminder: TenantJob = {
  name: "subscription_renewal_reminder",
  scope: "tenant",
  async periods(c, now, tenant) {
    const due = await dueSubscription(c, now, tenant);
    return due ? [reminderKey(due.id, due.end_date)] : [];
  },
  run: (c, ctx, tenant) => enqueueReminders(c, ctx, tenant),
};
