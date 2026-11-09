import type pg from "pg";

import { hashPassword, verifyPassword } from "../../../platform/crypto/password";
import { hashToken } from "../../../platform/crypto/token";
import { checkPassword } from "../domain/password-policy";
import type { Realm } from "../domain/realm";
import { retryAfterSeconds } from "../domain/throttle-policy";
import { withRealmTx } from "./realm-tx";
import { insertSession } from "./sessions";
import { isThrottled, loginKey, recordFailure } from "./throttle";

// AUT-08 changePassword (docs/06-backend-api.md 4.2.4): the current password is required and counted
// like a login failure; the policy runs before hashing; every other session ends and the caller gets
// a new session token (rotation).

export interface ChangePasswordInput {
  realm: Realm;
  sessionToken: string;
  currentPassword: string;
  newPassword: string;
  peppers: readonly string[];
  hmacKey: Buffer;
  now: Date;
}

export type ChangePasswordResult =
  | { status: "ok"; sessionToken: string }
  | { status: "unauthenticated" | "current_invalid" }
  | { status: "throttled"; retryAfterSeconds: number }
  | { status: "policy_failed"; problems: readonly string[] };

interface Account {
  id: string;
  username: string;
  password_hash: string;
}

async function findAccount(
  pool: pg.Pool,
  input: ChangePasswordInput,
): Promise<Account | undefined> {
  return withRealmTx(pool, input.realm, async (c) => {
    const res = await c.query<Account>(
      `SELECT u.id, u.username, u.password_hash FROM sessions s
         JOIN users u ON u.id = s.user_id AND u.tenant_id IS NOT DISTINCT FROM s.tenant_id
        WHERE s.token_hash = $1 AND s.realm = $2 AND u.status = 'active'
          AND s.idle_expires_at > $3 AND s.absolute_expires_at > $3 AND u.password_hash IS NOT NULL`,
      [hashToken(input.sessionToken), input.realm.kind, input.now],
    );
    return res.rows[0];
  });
}

async function rotate(pool: pg.Pool, input: ChangePasswordInput, userId: string, hash: string) {
  return withRealmTx(pool, input.realm, async (c) => {
    await c.query(
      "UPDATE users SET password_hash = $2, password_changed_at = $3, must_change_password = false, updated_at = $3 WHERE id = $1",
      [userId, hash, input.now],
    );
    await c.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    return insertSession(c, input.realm, userId, input.now);
  });
}

export async function changePassword(
  pool: pg.Pool,
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const account = await findAccount(pool, input);
  if (!account) {
    return { status: "unauthenticated" };
  }
  const tenantPart = input.realm.kind === "tenant" ? input.realm.tenantId : "system";
  const key = loginKey(input.hmacKey, tenantPart, account.username);
  if (await isThrottled(pool, key, input.now)) {
    return { status: "throttled", retryAfterSeconds: retryAfterSeconds(input.now) };
  }
  if (!(await verifyPassword(input.currentPassword, account.password_hash, input.peppers))) {
    await recordFailure(pool, key, input.now);
    return { status: "current_invalid" };
  }
  const policy = checkPassword(input.newPassword);
  if (!policy.ok) {
    return { status: "policy_failed", problems: policy.problems };
  }
  const hash = await hashPassword(input.newPassword, input.peppers[0] ?? "");
  const session = await rotate(pool, input, account.id, hash);
  return { status: "ok", sessionToken: session.token };
}
