import type pg from "pg";

import { hashPassword, verifyPassword } from "../../../platform/crypto/password";
import { generateToken, hashToken } from "../../../platform/crypto/token";
import { realmTenantId, type Realm } from "../domain/realm";
import { extendIdle, LAST_SEEN_THROTTLE_MS, newSessionWindow } from "../domain/session-policy";
import { retryAfterSeconds } from "../domain/throttle-policy";
import { withRealmTx } from "./realm-tx";
import { isThrottled, loginKey, recordFailure } from "./throttle";

export interface LoginInput {
  realm: Realm;
  username: string;
  password: string;
  peppers: readonly string[];
  hmacKey: Buffer;
  now: Date;
}

type LoginFailure = "unknown_user" | "not_active" | "bad_password";

export type LoginResult =
  | { status: "ok"; token: string; userId: string; absoluteExpiresAt: Date }
  | { status: "invalid"; reason: LoginFailure }
  | { status: "throttled"; retryAfterSeconds: number };

export interface ResolvedSession {
  userId: string;
  role: "admin" | "operator" | "systemadmin";
}

// Used when the username does not exist, so the response time does not reveal which usernames exist.
let dummyHash: Promise<string> | undefined;
function getDummyHash(pepper: string): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing", pepper);
  return dummyHash;
}

/** The account of this realm with that username, whatever its status (the caller decides). */
async function findUser(client: pg.PoolClient, input: LoginInput) {
  const res = await client.query<{ id: string; password_hash: string | null; status: string }>(
    `SELECT id, password_hash, status FROM users
      WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND username = $2
        AND (role = 'systemadmin') = ($1::uuid IS NULL)`,
    [realmTenantId(input.realm), input.username],
  );
  return res.rows[0];
}

/** The user id, or why the check failed (stored in security_event only; the answer stays generic). */
async function checkCredentials(
  pool: pg.Pool,
  input: LoginInput,
): Promise<{ id: string } | { failure: LoginFailure }> {
  return withRealmTx(pool, input.realm, async (client) => {
    const user = await findUser(client, input);
    const usable = user?.status === "active" && user.password_hash ? user.password_hash : null;
    // Always one hash verification, so timing does not tell the three failures apart.
    const ok = await verifyPassword(
      input.password,
      usable ?? (await getDummyHash(input.peppers[0] ?? "")),
      input.peppers,
    );
    if (!user) {
      return { failure: "unknown_user" };
    }
    if (!usable) {
      return { failure: "not_active" };
    }
    return ok ? { id: user.id } : { failure: "bad_password" };
  });
}

/** Inserts a session in the caller's transaction; returns the plaintext token once. */
export async function insertSession(
  client: pg.ClientBase,
  realm: Realm,
  userId: string,
  now: Date,
): Promise<{ token: string; absoluteExpiresAt: Date }> {
  const token = generateToken();
  const window = newSessionWindow(now, realm.kind);
  await client.query(
    `INSERT INTO sessions (id, tenant_id, realm, user_id, token_hash, idle_expires_at, absolute_expires_at, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
    [
      realmTenantId(realm),
      realm.kind,
      userId,
      hashToken(token),
      window.idleExpiresAt,
      window.absoluteExpiresAt,
      now,
    ],
  );
  await client.query("UPDATE users SET last_login_at = $2 WHERE id = $1", [userId, now]);
  return { token, absoluteExpiresAt: window.absoluteExpiresAt };
}

/**
 * Login with throttling (SR-AUT-05). A throttled attempt is refused before any password check, so
 * it costs no hashing time. A failed attempt is counted only after the check.
 */
export async function login(pool: pg.Pool, input: LoginInput): Promise<LoginResult> {
  const key = loginKey(input.hmacKey, realmTenantId(input.realm) ?? "system", input.username);
  if (await isThrottled(pool, key, input.now)) {
    return { status: "throttled", retryAfterSeconds: retryAfterSeconds(input.now) };
  }
  const user = await checkCredentials(pool, input);
  if ("failure" in user) {
    await recordFailure(pool, key, input.now);
    return { status: "invalid", reason: user.failure };
  }
  const session = await withRealmTx(pool, input.realm, (client) =>
    insertSession(client, input.realm, user.id, input.now),
  );
  return { status: "ok", userId: user.id, ...session };
}

interface SessionRow {
  id: string;
  user_id: string;
  role: ResolvedSession["role"];
  idle_expires_at: Date;
  absolute_expires_at: Date;
  last_seen_at: Date;
}

// A session is valid only for an active user, of the right realm, not older than the last password
// change, and (tenant realm) for an active tenant (06-backend-api 4.1).
const SESSION_LOOKUP = `
  SELECT s.id, s.user_id, u.role, s.idle_expires_at, s.absolute_expires_at, s.last_seen_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.tenant_id IS NOT DISTINCT FROM s.tenant_id
   WHERE s.token_hash = $1 AND s.realm = $2 AND u.status = 'active'
     AND (u.password_changed_at IS NULL OR u.password_changed_at <= s.created_at)
     AND (s.tenant_id IS NULL OR EXISTS (
           SELECT 1 FROM tenants t WHERE t.id = s.tenant_id AND t.status = 'active'))`;

/** Resolves a token to an active session, extending the idle window at most once per throttle interval. */
export async function resolveSession(
  pool: pg.Pool,
  input: { realm: Realm; token: string; now: Date },
): Promise<ResolvedSession | null> {
  return withRealmTx(pool, input.realm, async (client) => {
    const res = await client.query<SessionRow>(SESSION_LOOKUP, [
      hashToken(input.token),
      input.realm.kind,
    ]);
    const row = res.rows[0];
    if (!row || row.idle_expires_at <= input.now || row.absolute_expires_at <= input.now) {
      return null;
    }
    if (input.now.getTime() - row.last_seen_at.getTime() >= LAST_SEEN_THROTTLE_MS) {
      const idle = extendIdle(
        { idleExpiresAt: row.idle_expires_at, absoluteExpiresAt: row.absolute_expires_at },
        input.now,
        input.realm.kind,
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
  input: { realm: Realm; token: string },
): Promise<boolean> {
  return withRealmTx(pool, input.realm, async (client) => {
    const res = await client.query("DELETE FROM sessions WHERE token_hash = $1 AND realm = $2", [
      hashToken(input.token),
      input.realm.kind,
    ]);
    return (res.rowCount ?? 0) > 0;
  });
}
