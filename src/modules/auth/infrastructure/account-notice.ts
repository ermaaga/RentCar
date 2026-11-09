import type pg from "pg";

import { enqueueNotice } from "../../notifications";

// SR-AUT-10: a notice after every credential change, enqueued in the same transaction as the change
// and sent through the account's channel (admins and the systemadmin: system SMTP; operators: the
// tenant SMTP, 06-backend-api 9.2 "same channel as the account").

type AccountNotice =
  | "notice.password_changed"
  | "notice.password_reset_completed"
  | "notice.admin_access_changed"
  | "notice.email_changed";

export async function enqueueAccountNotice(
  c: pg.ClientBase,
  input: { userId: string; template: AccountNotice; now: Date; recipient?: string },
): Promise<void> {
  const res = await c.query<{ tenant_id: string | null; role: string; email: string }>(
    "SELECT tenant_id, role, email FROM users WHERE id = $1",
    [input.userId],
  );
  const user = res.rows[0];
  if (!user) {
    return;
  }
  await enqueueNotice(c, {
    tenantId: user.tenant_id,
    channel: user.role === "operator" ? "tenant_smtp" : "system_smtp",
    template: input.template,
    userId: input.userId,
    recipient: input.recipient ?? user.email,
    now: input.now,
  });
}
