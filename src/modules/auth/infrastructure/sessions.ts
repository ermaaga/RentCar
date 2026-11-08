import type pg from "pg";

import { hashPassword, verifyPassword } from "../../../platform/crypto/password";
import { generateToken, hashToken } from "../../../platform/crypto/token";
import { withTenantTx } from "../../../platform/db/tenant-tx";
import { extendIdle, LAST_SEEN_THROTTLE_MS, newSessionWindow } from "../domain/session-policy";
import { retryAfterSeconds } from "../domain/throttle-policy";
import { isThrottled, loginKey, recordFailure } from "./throttle";

export interface LoginInput {
  tenantId: string;
  username: string;
  password: string;
  peppers: readonly string[];
  hmacKey: Buffer;
  now: Date;
}

export type LoginResult =
  | { status: "ok"; token: string; userId: string; absoluteExpiresAt: Date }
  | { status: "invalid" }
  | { status: "throttled"; retryAfterSeconds: number };

export interface ResolvedSession {
  userId: string;
  role: "admin" | "operator";
}

// Used when the username does not exist, so the response time does not reveal which usernames exist.
let dummyHash: Promise<string> | undefined;
function getDummyHash(pepper: string): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing", pepper);
  return dummyHash;
}

async function findActiveUser(client: pg.PoolClient, input: LoginInput) {
  const res = await client.query<{ id: string; password_hash: string | null }>(
    "SELECT id, password_hash FROM users WHERE tenant_id = $1 AND username = $2 AND status = 'active'",
    [input.tenantId, input.username],
  );
  return res.rows[0];
}

async function checkCredentials(pool: pg.Pool, input: LoginInput): Promise<{ id: string } | null> {
  return withTenantTx(pool, input.tenantId, async (client) => {
    const user = await findActiveUser(client, input);
    const storedHash = user?.password_hash ?? (await getDummyHash(input.peppers[0] ?? ""));
    const ok = await verifyPassword(input.password, storedHash, input.peppers);
    return user?.password_hash && ok ? { id: user.id } : null;
  });
}

async function openSessionRow(
  pool: pg.Pool,
  input: LoginInput,
  userId: string,
): Promise<LoginResult> {
  const token = generateToken();
  const window = newSessionWindow(input.now);
  await withTenantTx(pool, input.tenantId, async (client) => {
    await client.query(
      `INSERT INTO sessions (id, tenant_id, realm, user_id, token_hash, idle_expires_at, absolute_expires_at)
       VALUES (gen_random_uuid(), $1, 'tenant', $2, $3, $4, $5)`,
      [input.tenantId, userId, hashToken(token), window.idleExpiresAt, window.absoluteExpiresAt],
    );
    await client.query("UPDATE users SET last_login_at = $2 WHERE id = $1", [userId, input.now]);
  });
  return { status: "ok", token, userId, absoluteExpiresAt: window.absoluteExpiresAt };
}

/**
 * Login with throttling (SR-AUT-05). A throttled attempt is refused before any password check, so
 * it costs no hashing time. A failed attempt is counted only after the check.
 */
export async function login(pool: pg.Pool, input: LoginInput): Promise<LoginResult> {
  const key = loginKey(input.hmacKey, input.tenantId, input.username);
  if (await isThrottled(pool, key, input.now)) {
    return { status: "throttled", retryAfterSeconds: retryAfterSeconds(input.now) };
  }
  const user = await checkCredentials(pool, input);
  if (!user) {
    await recordFailure(pool, key, input.now);
    return { status: "invalid" };
  }
  return openSessionRow(pool, input, user.id);
}

/** Resolves a token to an active session, extending the idle window at most once per throttle interval. */
export async function resolveSession(
  pool: pg.Pool,
  input: { tenantId: string; token: string; now: Date },
): Promise<ResolvedSession | null> {
  return withTenantTx(pool, input.tenantId, async (client) => {
    const res = await client.query<{
      id: string;
      user_id: string;
      role: "admin" | "operator";
      idle_expires_at: Date;
      absolute_expires_at: Date;
      last_seen_at: Date;
    }>(
      `SELECT s.id, s.user_id, u.role, s.idle_expires_at, s.absolute_expires_at, s.last_seen_at
         FROM sessions s JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id
        WHERE s.token_hash = $1 AND u.status = 'active'`,
      [hashToken(input.token)],
    );
    const row = res.rows[0];
    if (!row || row.idle_expires_at <= input.now || row.absolute_expires_at <= input.now) {
      return null;
    }
    if (input.now.getTime() - row.last_seen_at.getTime() >= LAST_SEEN_THROTTLE_MS) {
      const idle = extendIdle(
        { idleExpiresAt: row.idle_expires_at, absoluteExpiresAt: row.absolute_expires_at },
        input.now,
      );
      await client.query(
        "UPDATE sessions SET last_seen_at = $2, idle_expires_at = $3 WHERE id = $1",
        [row.id, input.now, idle],
      );
    }
    return { userId: row.user_id, role: row.role };
  });
}

/** Logout: deletes the session row (05-database 5.6: revocation is deletion). */
export async function revokeSession(
  pool: pg.Pool,
  input: { tenantId: string; token: string },
): Promise<boolean> {
  return withTenantTx(pool, input.tenantId, async (client) => {
    const res = await client.query("DELETE FROM sessions WHERE token_hash = $1", [
      hashToken(input.token),
    ]);
    return (res.rowCount ?? 0) > 0;
  });
}
