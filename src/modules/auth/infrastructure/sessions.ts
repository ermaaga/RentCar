import type pg from "pg";

import { hashPassword, verifyPassword } from "../../../platform/crypto/password";
import { generateToken, hashToken } from "../../../platform/crypto/token";
import { withTenantTx } from "../../../platform/db/tenant-tx";
import { extendIdle, LAST_SEEN_THROTTLE_MS, newSessionWindow } from "../domain/session-policy";

export interface LoginInput {
  tenantId: string;
  username: string;
  password: string;
  peppers: readonly string[];
  now: Date;
}

export interface LoggedIn {
  token: string;
  userId: string;
  absoluteExpiresAt: Date;
}

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

/** Returns a new session token on success, or null for any failure (wrong user, password, or status). */
export async function login(pool: pg.Pool, input: LoginInput): Promise<LoggedIn | null> {
  const pepper = input.peppers[0] ?? "";
  return withTenantTx(pool, input.tenantId, async (client) => {
    const user = await findActiveUser(client, input);
    const storedHash = user?.password_hash ?? (await getDummyHash(pepper));
    const ok = await verifyPassword(input.password, storedHash, input.peppers);
    if (!user?.password_hash || !ok) {
      return null;
    }
    const token = generateToken();
    const window = newSessionWindow(input.now);
    await client.query(
      `INSERT INTO sessions (id, tenant_id, realm, user_id, token_hash, idle_expires_at, absolute_expires_at)
       VALUES (gen_random_uuid(), $1, 'tenant', $2, $3, $4, $5)`,
      [input.tenantId, user.id, hashToken(token), window.idleExpiresAt, window.absoluteExpiresAt],
    );
    await client.query("UPDATE users SET last_login_at = $2 WHERE id = $1", [user.id, input.now]);
    return { token, userId: user.id, absoluteExpiresAt: window.absoluteExpiresAt };
  });
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
