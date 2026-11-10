import type pg from "pg";

import type { MessageKey } from "../../../i18n";
import type { MailMessage } from "../../../platform/mailer/port";
import { isNoticeTemplate, renderNotice } from "../application/notice-email";
import { isRenewalTemplate, renderRenewal } from "../application/renewal-email";

type Translate = (key: MessageKey) => string;

// EmailDataSource of the outbox (docs/06-backend-api.md 9.3 step 3): each template loads what it needs
// from the related record at send time, in the dispatch scope. Missing data gives null (abandoned).

/**
 * A template whose data lives in another module (docs/06-backend-api.md 3.x item 1): that module
 * loads its record and renders the message; composition registers it, so this module never imports it.
 */
interface EmailDataSource {
  load(c: pg.ClientBase, row: OutboxRow, t: Translate): Promise<MailMessage | null>;
}

export type EmailSources = Readonly<Record<string, EmailDataSource>>;

export interface OutboxRow {
  template: string;
  related_id: string;
  tenant_id: string | null;
  recipient: string | null;
}

async function noticeMail(c: pg.ClientBase, row: OutboxRow, to: string, t: Translate) {
  if (!isNoticeTemplate(row.template)) {
    return null;
  }
  const res = await c.query<{ display_name: string }>(
    "SELECT display_name FROM users WHERE id = $1 AND tenant_id IS NOT DISTINCT FROM $2::uuid",
    [row.related_id, row.tenant_id],
  );
  const user = res.rows[0];
  return user ? renderNotice(row.template, { to, displayName: user.display_name }, t) : null;
}

async function renewalMail(c: pg.ClientBase, row: OutboxRow, to: string, t: Translate) {
  if (!isRenewalTemplate(row.template)) {
    return null;
  }
  const res = await c.query<{ name: string; slug: string; end_date: string }>(
    `SELECT t.name, t.slug, to_char(s.end_date, 'YYYY-MM-DD') AS end_date
       FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
      WHERE s.id = $1 AND s.tenant_id = $2`,
    [row.related_id, row.tenant_id],
  );
  const data = res.rows[0];
  return data
    ? renderRenewal(
        row.template,
        { to, tenantName: data.name, slug: data.slug, endDate: data.end_date },
        t,
      )
    : null;
}

/** Renders a claimed row, or null when its template or related record is unknown. */
export async function renderOutboxRow(
  c: pg.ClientBase,
  row: OutboxRow,
  t: Translate,
  sources: EmailSources = {},
): Promise<MailMessage | null> {
  if (!row.recipient) {
    return null;
  }
  const source = sources[row.template];
  if (source) {
    return source.load(c, row, t);
  }
  if (isNoticeTemplate(row.template)) {
    return noticeMail(c, row, row.recipient, t);
  }
  return renewalMail(c, row, row.recipient, t);
}
