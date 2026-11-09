import type pg from "pg";

import { hashPassword } from "../../../platform/crypto/password";
import { generateToken, hashToken } from "../../../platform/crypto/token";
import {
  credentialExpiry,
  credentialState,
  startsSession,
  type CredentialPurpose,
  type CredentialState,
} from "../domain/credential-policy";
import { checkPassword } from "../domain/password-policy";
import { realmTenantId, type Realm } from "../domain/realm";
import { withRealmTx } from "./realm-tx";
import { insertSession } from "./sessions";

// Set-password links for tenant staff and the systemadmin (docs/06-backend-api.md 4.2.2). Only the SHA-256 of the token
// is stored; the plaintext is returned to the caller in memory and never logged or persisted.

export interface IssueInput {
  realm: Realm;
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
      realmTenantId(input.realm),
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

// The realm filter matters in the system scope, which can read every token: a tenant link must
// never be redeemable through the system pages.
async function readLink(
  client: pg.ClientBase,
  realm: Realm,
  token: string,
): Promise<LinkRow | undefined> {
  const res = await client.query<LinkRow>(
    `SELECT t.user_id, t.purpose, u.username, u.email, t.expires_at, t.used_at, t.superseded_at
       FROM credential_tokens t
       JOIN users u ON u.id = t.user_id AND u.tenant_id IS NOT DISTINCT FROM t.tenant_id
      WHERE t.token_hash = $1 AND t.tenant_id IS NOT DISTINCT FROM $2::uuid
        AND u.status <> 'deactivated'`,
    [hashToken(token), realmTenantId(realm)],
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
  input: { realm: Realm; token: string; now: Date },
): Promise<CredentialPeek> {
  return withRealmTx(pool, input.realm, async (client) =>
    toPeek(await readLink(client, input.realm, input.token), input.now),
  );
}

export interface RedeemInput {
  realm: Realm;
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
        AND tenant_id IS NOT DISTINCT FROM $3::uuid
      RETURNING user_id, purpose`,
    [hashToken(input.token), input.now, realmTenantId(input.realm)],
  );
  const row = res.rows[0];
  return row && { userId: row.user_id, purpose: row.purpose };
}

/** The system realm has no tenant; a tenant realm needs an active tenant. */
async function realmIsOpen(client: pg.ClientBase, realm: Realm): Promise<boolean> {
  if (realm.kind === "system") {
    return true;
  }
  const res = await client.query<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [
    realm.tenantId,
  ]);
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
    return await withRealmTx(pool, input.realm, (client) => applyRedeem(client, input, hash));
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
  if (!used || !(await realmIsOpen(client, input.realm))) {
    throw new RedeemRefused();
  }
  if (!(await setPassword(client, used.userId, hash, input.now))) {
    throw new RedeemRefused();
  }
  if (!startsSession(used.purpose)) {
    return { status: "ok", purpose: used.purpose };
  }
  const session = await insertSession(client, input.realm, used.userId, input.now);
  return { status: "ok", purpose: used.purpose, sessionToken: session.token };
}
