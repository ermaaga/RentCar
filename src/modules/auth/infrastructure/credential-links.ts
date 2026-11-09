import type pg from "pg";

import { hashPassword } from "../../../platform/crypto/password";
import { generateToken, hashToken } from "../../../platform/crypto/token";
import { withTenantTx } from "../../../platform/db/tenant-tx";
import {
  credentialExpiry,
  credentialState,
  startsSession,
  type CredentialPurpose,
  type CredentialState,
} from "../domain/credential-policy";
import { checkPassword } from "../domain/password-policy";
import { insertSession } from "./sessions";

// Set-password links for tenant staff (docs/06-backend-api.md 4.2.2). Only the SHA-256 of the token
// is stored; the plaintext is returned to the caller in memory and never logged or persisted.

export interface IssueInput {
  tenantId: string;
  userId: string;
  purpose: CredentialPurpose;
  createdByUserId?: string;
  now: Date;
}

/** Issues a link inside the creator's transaction, superseding the live one for (user, purpose). */
export async function issueCredentialLink(
  client: pg.ClientBase,
  input: IssueInput,
): Promise<string> {
  const token = generateToken();
  await client.query(
    `UPDATE credential_tokens SET superseded_at = $3
      WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL AND superseded_at IS NULL`,
    [input.userId, input.purpose, input.now],
  );
  await client.query(
    `INSERT INTO credential_tokens (id, tenant_id, user_id, purpose, token_hash, expires_at, created_by_user_id, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
    [
      input.tenantId,
      input.userId,
      input.purpose,
      hashToken(token),
      credentialExpiry(input.purpose, input.now),
      input.createdByUserId ?? null,
      input.now,
    ],
  );
  return token;
}

export interface CredentialPeek {
  state: CredentialState;
  purpose?: CredentialPurpose;
  username?: string;
}

interface LinkRow {
  user_id: string;
  purpose: CredentialPurpose;
  username: string;
  email: string;
  expires_at: Date;
  used_at: Date | null;
  superseded_at: Date | null;
}

async function readLink(client: pg.ClientBase, token: string): Promise<LinkRow | undefined> {
  const res = await client.query<LinkRow>(
    `SELECT t.user_id, t.purpose, u.username, u.email, t.expires_at, t.used_at, t.superseded_at
       FROM credential_tokens t JOIN users u ON u.tenant_id = t.tenant_id AND u.id = t.user_id
      WHERE t.token_hash = $1 AND u.status <> 'deactivated'`,
    [hashToken(token)],
  );
  return res.rows[0];
}

function toPeek(row: LinkRow | undefined, now: Date): CredentialPeek {
  const state = credentialState(
    row && { expiresAt: row.expires_at, usedAt: row.used_at, supersededAt: row.superseded_at },
    now,
  );
  return state === "valid" && row
    ? { state, purpose: row.purpose, username: row.username }
    : { state };
}

/** Read only: a scanner that opens the link cannot burn it. */
export async function peekCredentialLink(
  pool: pg.Pool,
  input: { tenantId: string; token: string; now: Date },
): Promise<CredentialPeek> {
  return withTenantTx(pool, input.tenantId, async (client) =>
    toPeek(await readLink(client, input.token), input.now),
  );
}

export interface RedeemInput {
  tenantId: string;
  token: string;
  password: string;
  pepper: string;
  now: Date;
}

export type RedeemResult =
  | { status: "ok"; purpose: CredentialPurpose; sessionToken?: string }
  | { status: "invalid" }
  | { status: "policy_failed"; problems: readonly string[] };

async function consume(
  client: pg.ClientBase,
  input: RedeemInput,
): Promise<{ userId: string; purpose: CredentialPurpose } | undefined> {
  const res = await client.query<{ user_id: string; purpose: CredentialPurpose }>(
    `UPDATE credential_tokens SET used_at = $2
      WHERE token_hash = $1 AND used_at IS NULL AND superseded_at IS NULL AND expires_at > $2
      RETURNING user_id, purpose`,
    [hashToken(input.token), input.now],
  );
  const row = res.rows[0];
  return row && { userId: row.user_id, purpose: row.purpose };
}

async function tenantIsActive(client: pg.ClientBase): Promise<boolean> {
  const res = await client.query<{ status: string }>("SELECT status FROM tenants");
  return res.rows[0]?.status === "active";
}

async function setPassword(
  client: pg.ClientBase,
  userId: string,
  hash: string,
  now: Date,
): Promise<boolean> {
  const res = await client.query(
    `UPDATE users SET password_hash = $2, password_changed_at = $3, status = 'active',
            must_change_password = false, updated_at = $3
      WHERE id = $1 AND status <> 'deactivated'`,
    [userId, hash, now],
  );
  await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  return (res.rowCount ?? 0) === 1;
}

/**
 * Sets the password through a link. The policy runs first and does not consume the link; hashing runs
 * outside the transaction; consumption is a single conditional UPDATE, so of two concurrent redeems
 * exactly one wins (ABU-M1-13).
 */
export async function redeemCredentialLink(
  pool: pg.Pool,
  input: RedeemInput,
): Promise<RedeemResult> {
  const peek = await peekCredentialLink(pool, input);
  if (peek.state !== "valid") {
    return { status: "invalid" };
  }
  const policy = checkPassword(input.password);
  if (!policy.ok) {
    return { status: "policy_failed", problems: policy.problems };
  }
  const hash = await hashPassword(input.password, input.pepper);
  try {
    return await withTenantTx(pool, input.tenantId, (client) => applyRedeem(client, input, hash));
  } catch (err) {
    if (err instanceof RedeemRefused) {
      return { status: "invalid" };
    }
    throw err;
  }
}

/** Thrown inside the transaction so it rolls back and the link stays unconsumed. */
class RedeemRefused extends Error {}

async function applyRedeem(
  client: pg.ClientBase,
  input: RedeemInput,
  hash: string,
): Promise<RedeemResult> {
  const used = await consume(client, input);
  if (!used || !(await tenantIsActive(client))) {
    throw new RedeemRefused();
  }
  if (!(await setPassword(client, used.userId, hash, input.now))) {
    throw new RedeemRefused();
  }
  if (!startsSession(used.purpose)) {
    return { status: "ok", purpose: used.purpose };
  }
  const session = await insertSession(client, input.tenantId, used.userId, input.now);
  return { status: "ok", purpose: used.purpose, sessionToken: session.token };
}
