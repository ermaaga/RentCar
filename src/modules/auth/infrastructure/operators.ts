import { randomUUID } from "node:crypto";
import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import { localDate } from "../../subscriptions";
import { tenantRealm } from "../domain/realm";
import { issueCredentialLink } from "./credential-links";

// Operators (docs/06-backend-api.md 4.2.5, AUT-12/14/15/16). Tenant scope only: every query is bound
// to the tenant transaction and to role = 'operator', so an admin id never matches. The plan limit is
// checked under a transaction-level advisory lock (US-013: two parallel creates at limit-1 give one).

type OperatorStatus = "pending" | "active" | "deactivated" | "activation_not_delivered";

export interface OperatorRow {
  id: string;
  username: string;
  displayName: string;
  email: string;
  status: OperatorStatus;
}

export interface OperatorUsage {
  used: number;
  max: number;
}

/** A credential link issued in the transaction; the caller emails it and records the outcome. */
export interface IssuedOperatorLink {
  operatorId: string;
  emailLogId: string;
  token: string;
  email: string;
  displayName: string;
  username: string;
}

const UNDELIVERED_AFTER_MS = 15 * 60_000;

async function operatorLimit(c: pg.ClientBase, tenantId: string, now: Date): Promise<number> {
  const tz = await c.query<{ time_zone: string }>("SELECT time_zone FROM tenants WHERE id = $1", [
    tenantId,
  ]);
  const today = localDate(now, tz.rows[0]?.time_zone ?? "UTC");
  // The subscription containing today, else the latest one (same rule as the effective access).
  const res = await c.query<{ max_operators: number }>(
    `SELECT max_operators FROM subscriptions
      WHERE tenant_id = $1 AND status <> 'cancelled'
      ORDER BY (start_date <= $2::date AND end_date >= $2::date) DESC, end_date DESC
      LIMIT 1`,
    [tenantId, today],
  );
  return res.rows[0]?.max_operators ?? 0;
}

async function countSeats(c: pg.ClientBase, tenantId: string): Promise<number> {
  const res = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users
      WHERE tenant_id = $1 AND role = 'operator' AND status IN ('pending', 'active')`,
    [tenantId],
  );
  return res.rows[0]?.n ?? 0;
}

/** Takes the limit lock and tells whether one more seat fits (SUB-04). */
async function seatAvailable(c: pg.ClientBase, tenantId: string, now: Date): Promise<boolean> {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `limit:operators:${tenantId}`,
  ]);
  return (await countSeats(c, tenantId)) < (await operatorLimit(c, tenantId, now));
}

export async function operatorUsage(
  pool: pg.Pool,
  tenantId: string,
  now: Date,
): Promise<OperatorUsage> {
  return withTenantTx(pool, tenantId, async (c) => ({
    used: await countSeats(c, tenantId),
    max: await operatorLimit(c, tenantId, now),
  }));
}

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

async function issueLink(
  c: pg.ClientBase,
  input: { tenantId: string; operatorId: string; actorUserId: string; now: Date },
): Promise<{ token: string; emailLogId: string }> {
  const token = await issueCredentialLink(c, {
    realm: tenantRealm(input.tenantId),
    userId: input.operatorId,
    purpose: "activation",
    createdByUserId: input.actorUserId,
    now: input.now,
  });
  // The recipient is not stored: the row only proves (and later reports) delivery.
  const emailLogId = randomUUID();
  await c.query(
    `INSERT INTO email_log (id, tenant_id, channel, category, template, related_type, related_id,
                            max_attempts, created_at)
     VALUES ($1, $2, 'tenant_smtp', 'credential', 'credential.activation', 'user', $3, 1, $4)`,
    [emailLogId, input.tenantId, input.operatorId, input.now],
  );
  return { token, emailLogId };
}

export interface CreateOperatorInput {
  displayName: string;
  username: string;
  email: string;
}

export type CreateOperatorResult =
  | { ok: true; link: IssuedOperatorLink }
  | { ok: false; code: "USERNAME_TAKEN" | "PLAN_LIMIT_REACHED" };

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

/** AUT-12: a pending operator plus an activation link, in one tenant transaction. */
export async function createOperator(
  pool: pg.Pool,
  input: CreateOperatorInput,
  ctx: { tenantId: string; actorUserId: string; now: Date },
): Promise<CreateOperatorResult> {
  try {
    return await withTenantTx(pool, ctx.tenantId, async (c) => {
      if (!(await seatAvailable(c, ctx.tenantId, ctx.now))) {
        return { ok: false, code: "PLAN_LIMIT_REACHED" };
      }
      const operatorId = randomUUID();
      await c.query(
        `INSERT INTO users (id, tenant_id, role, username, display_name, email, created_at, updated_at)
         VALUES ($1, $2, 'operator', $3, $4, $5, $6, $6)`,
        [operatorId, ctx.tenantId, input.username, input.displayName, input.email, ctx.now],
      );
      const issued = await issueLink(c, { ...ctx, operatorId });
      return { ok: true, link: { operatorId, ...issued, ...input } };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, code: "USERNAME_TAKEN" };
    }
    throw err;
  }
}

interface OperatorRecord {
  id: string;
  username: string;
  display_name: string;
  email: string;
  status: "pending" | "active" | "deactivated";
  password_hash: string | null;
}

async function lockOperator(
  c: pg.ClientBase,
  tenantId: string,
  id: string,
): Promise<OperatorRecord | undefined> {
  const res = await c.query<OperatorRecord>(
    `SELECT id, username, display_name, email, status, password_hash FROM users
      WHERE tenant_id = $1 AND id = $2 AND role = 'operator' FOR UPDATE`,
    [tenantId, id],
  );
  return res.rows[0];
}

export type SetActiveResult =
  | { ok: true; changed: boolean; sessionsRevoked: number }
  | { ok: false; code: "NOT_FOUND" | "PLAN_LIMIT_REACHED" };

async function reactivate(
  c: pg.ClientBase,
  op: OperatorRecord,
  ctx: { tenantId: string; now: Date },
): Promise<SetActiveResult> {
  if (!(await seatAvailable(c, ctx.tenantId, ctx.now))) {
    return { ok: false, code: "PLAN_LIMIT_REACHED" };
  }
  await c.query(
    "UPDATE users SET status = $2, deactivated_at = NULL, updated_at = $3 WHERE id = $1",
    [op.id, op.password_hash ? "active" : "pending", ctx.now],
  );
  return { ok: true, changed: true, sessionsRevoked: 0 };
}

async function deactivate(
  c: pg.ClientBase,
  op: OperatorRecord,
  now: Date,
): Promise<SetActiveResult> {
  await c.query(
    "UPDATE users SET status = 'deactivated', deactivated_at = $2, updated_at = $2 WHERE id = $1",
    [op.id, now],
  );
  await c.query(
    `UPDATE credential_tokens SET superseded_at = $2
      WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL`,
    [op.id, now],
  );
  const sessions = await c.query("DELETE FROM sessions WHERE user_id = $1", [op.id]);
  return { ok: true, changed: true, sessionsRevoked: sessions.rowCount ?? 0 };
}

/** AUT-14: deactivation signs the operator out and frees the seat; reactivation needs a seat. */
export async function setOperatorActive(
  pool: pg.Pool,
  input: { id: string; active: boolean },
  ctx: { tenantId: string; now: Date },
): Promise<SetActiveResult> {
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const op = await lockOperator(c, ctx.tenantId, input.id);
    if (!op) {
      return { ok: false, code: "NOT_FOUND" };
    }
    const isActive = op.status !== "deactivated";
    if (isActive === input.active) {
      return { ok: true, changed: false, sessionsRevoked: 0 };
    }
    return input.active ? reactivate(c, op, ctx) : deactivate(c, op, ctx.now);
  });
}

export type ReissueResult =
  { ok: true; link: IssuedOperatorLink } | { ok: false; code: "NOT_FOUND" | "NOT_PENDING" };

/** AUT-15: a fresh activation link for an operator who has not set a password yet. */
export async function reissueOperatorLink(
  pool: pg.Pool,
  input: { id: string },
  ctx: { tenantId: string; actorUserId: string; now: Date },
): Promise<ReissueResult> {
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const op = await lockOperator(c, ctx.tenantId, input.id);
    if (!op) {
      return { ok: false, code: "NOT_FOUND" };
    }
    if (op.status !== "pending") {
      return { ok: false, code: "NOT_PENDING" };
    }
    const issued = await issueLink(c, { ...ctx, operatorId: op.id });
    return {
      ok: true,
      link: {
        operatorId: op.id,
        ...issued,
        email: op.email,
        displayName: op.display_name,
        username: op.username,
      },
    };
  });
}

/** Records the outcome of the awaited credential email (never retried: SR-AUT credential rule). */
export async function recordCredentialDelivery(
  pool: pg.Pool,
  input: { tenantId: string; emailLogId: string; ok: boolean; category?: string; now: Date },
): Promise<void> {
  await withTenantTx(pool, input.tenantId, (c) =>
    c.query(
      `UPDATE email_log SET status = $3::text, attempts = 1, last_attempt_at = $4::timestamptz,
              sent_at = CASE WHEN $3::text = 'sent' THEN $4::timestamptz END, last_error = $5
        WHERE id = $1 AND tenant_id = $2`,
      [
        input.emailLogId,
        input.tenantId,
        input.ok ? "sent" : "failed",
        input.now,
        input.ok ? null : (input.category ?? "unknown"),
      ],
    ),
  );
}
