import { randomUUID } from "node:crypto";
import type pg from "pg";

import type { MessageKey } from "../../../i18n";
import { withSystemTx } from "../../../platform/db/system-tx";
import { withTenantTx } from "../../../platform/db/tenant-tx";
import type { Mailer, MailMessage, SendResult } from "../../../platform/mailer/port";
import type { NoticeTemplate } from "../application/notice-email";
import type { RenewalTemplate } from "../application/renewal-email";
import { renderOutboxRow, type EmailSources, type RenderedMail } from "./outbox-render";
import { sendTenantMail } from "./tenant-mail";

// Transactional outbox (docs/06-backend-api.md 9.3, 05-database 5.15). A row is enqueued inside the
// business transaction; dispatch claims due rows in its own short transaction, renders from the
// related record (no body is ever stored), sends with no transaction open and records the outcome:
// sent, failed with a backoff, or abandoned after the last attempt. Errors are categories only.

type MailChannel = "system_smtp" | "tenant_smtp";

const BACKOFF_MS = [5, 30, 120, 360, 1440].map((minutes) => minutes * 60_000);
const LOCK_MS = 60_000;
const CREDENTIAL_UNDELIVERED_MS = 15 * 60_000;

export interface EmailEnqueue {
  tenantId: string | null;
  channel: MailChannel;
  /** A notice or renewal template, or one registered by another module as an EmailDataSource. */
  template: NoticeTemplate | RenewalTemplate | `booking.${string}`;
  related: { type: "user" | "subscription" | "booking"; id: string };
  recipient: string;
  now: Date;
}

/** Inserts a pending transactional row in the caller's transaction (same commit as the change). */
export async function enqueueEmail(c: pg.ClientBase, input: EmailEnqueue): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO email_log (id, tenant_id, channel, category, template, related_type, related_id,
                            recipient, status, attempts, max_attempts, next_attempt_at, created_at)
     VALUES ($1, $2, $3, 'transactional', $4, $5, $6, $7, 'pending', 0, $8, $9, $9)`,
    [
      id,
      input.tenantId,
      input.channel,
      input.template,
      input.related.type,
      input.related.id,
      input.recipient,
      BACKOFF_MS.length,
      input.now,
    ],
  );
  return id;
}

export interface NoticeEnqueue {
  tenantId: string | null;
  channel: MailChannel;
  template: NoticeTemplate;
  userId: string;
  recipient: string;
  now: Date;
}

/** An account notice (related to the user it is about). */
export function enqueueNotice(c: pg.ClientBase, input: NoticeEnqueue): Promise<string> {
  const { userId, ...rest } = input;
  return enqueueEmail(c, { ...rest, related: { type: "user", id: userId } });
}

/** Where dispatch runs: one tenant's rows, or the platform rows (tenant_id NULL). */
export type OutboxScope = { kind: "tenant"; tenantId: string } | { kind: "platform" };

export interface OutboxDeps {
  pool: pg.Pool;
  mailer: Mailer;
  fieldKeys: readonly Buffer[];
  t: (key: MessageKey) => string;
  /** Templates rendered by other modules (registered in composition). */
  sources?: EmailSources | undefined;
}

interface Claimed {
  id: string;
  tenant_id: string | null;
  channel: MailChannel;
  template: string;
  related_id: string;
  recipient: string | null;
  attempts: number;
  max_attempts: number;
}

function inScope<T>(pool: pg.Pool, scope: OutboxScope, fn: (c: pg.PoolClient) => Promise<T>) {
  return scope.kind === "tenant" ? withTenantTx(pool, scope.tenantId, fn) : withSystemTx(pool, fn);
}

/** Claims up to `limit` due rows (pending/failed past their time, or `sending` with an expired lock). */
async function claimDue(
  pool: pg.Pool,
  scope: OutboxScope,
  now: Date,
  limit: number,
): Promise<Claimed[]> {
  return inScope(pool, scope, async (c) => {
    const res = await c.query<Claimed>(
      `WITH due AS (
         SELECT id FROM email_log
          WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND category = 'transactional'
            AND ((status IN ('pending', 'failed') AND next_attempt_at <= $2)
                 OR (status = 'sending' AND locked_until < $2))
          ORDER BY next_attempt_at
          LIMIT $3
          FOR UPDATE SKIP LOCKED
       )
       UPDATE email_log e SET status = 'sending', locked_until = $4, attempts = e.attempts + 1,
              last_attempt_at = $2
         FROM due WHERE e.id = due.id
       RETURNING e.id, e.tenant_id, e.channel, e.template, e.related_id, e.recipient, e.attempts,
                 e.max_attempts`,
      [
        scope.kind === "tenant" ? scope.tenantId : null,
        now,
        limit,
        new Date(now.getTime() + LOCK_MS),
      ],
    );
    return res.rows;
  });
}

/** Renders in a short read transaction, then sends with no transaction open (9.3 steps 3-5). */
async function send(
  deps: OutboxDeps,
  scope: OutboxScope,
  row: Claimed,
): Promise<{ result: SendResult; unusable: boolean }> {
  const mail = await inScope(deps.pool, scope, (c) =>
    renderOutboxRow(c, row, deps.t, deps.sources),
  );
  if (!mail) {
    return { result: { ok: false, category: "unknown" }, unusable: true };
  }
  const message = await materialise(mail);
  const result =
    row.channel === "tenant_smtp" && row.tenant_id
      ? await sendTenantMail(deps, row.tenant_id, message)
      : await deps.mailer.sendSystem(message);
  return { result, unusable: false };
}

/** Renders the lazy attachments with no transaction open; a failure fails this attempt (retried). */
async function materialise(mail: RenderedMail): Promise<MailMessage> {
  const { lazyAttachments = [], ...message } = mail;
  if (lazyAttachments.length === 0) return message;
  const rendered = await Promise.all(
    lazyAttachments.map(async (a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: await a.render(),
    })),
  );
  return { ...message, attachments: [...(message.attachments ?? []), ...rendered] };
}

type Outcome = "sent" | "failed" | "abandoned";

async function record(
  pool: pg.Pool,
  scope: OutboxScope,
  row: Claimed,
  sent: { result: SendResult; unusable: boolean; now: Date },
): Promise<Outcome> {
  const { result, unusable, now } = sent;
  const outcome: Outcome = result.ok
    ? "sent"
    : unusable || row.attempts >= row.max_attempts
      ? "abandoned"
      : "failed";
  const backoff = BACKOFF_MS[Math.min(row.attempts, BACKOFF_MS.length) - 1] ?? 0;
  await inScope(pool, scope, (c) =>
    c.query(
      `UPDATE email_log SET status = $2::text, locked_until = NULL,
              sent_at = CASE WHEN $2::text = 'sent' THEN $3::timestamptz END,
              next_attempt_at = CASE WHEN $2::text = 'failed' THEN $4::timestamptz END,
              last_error = $5
        WHERE id = $1`,
      [row.id, outcome, now, new Date(now.getTime() + backoff), result.ok ? null : result.category],
    ),
  );
  return outcome;
}

export interface DispatchCounts {
  sent: number;
  failed: number;
  abandoned: number;
}

/** Sends the due rows of one scope. Safe to run concurrently: claims use SKIP LOCKED. */
export async function dispatchDue(
  deps: OutboxDeps,
  scope: OutboxScope,
  now: Date,
  limit = 20,
): Promise<DispatchCounts> {
  const counts: DispatchCounts = { sent: 0, failed: 0, abandoned: 0 };
  for (const row of await claimDue(deps.pool, scope, now, limit)) {
    const failed: SendResult = { ok: false, category: "unknown" };
    const sent = await send(deps, scope, row).catch(() => ({ result: failed, unusable: false }));
    counts[await record(deps.pool, scope, row, { ...sent, now })] += 1;
  }
  return counts;
}

/** Credential rows still pending after 15 minutes are failed, never retried (9.2, 8.2). */
export async function failStaleCredentialRows(
  pool: pg.Pool,
  scope: OutboxScope,
  now: Date,
): Promise<number> {
  const res = await inScope(pool, scope, (c) =>
    c.query(
      `UPDATE email_log SET status = 'failed', last_error = 'not_delivered'
        WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND category = 'credential'
          AND status = 'pending' AND created_at < $2`,
      [
        scope.kind === "tenant" ? scope.tenantId : null,
        new Date(now.getTime() - CREDENTIAL_UNDELIVERED_MS),
      ],
    ),
  );
  return res.rowCount ?? 0;
}
