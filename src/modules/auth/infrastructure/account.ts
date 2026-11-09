import type pg from "pg";

import type { Realm } from "../domain/realm";
import { withRealmTx } from "./realm-tx";

export interface AccountContact {
  username: string;
  email: string;
  displayName: string;
}

/** The signed-in user's own contact (for mail sent to oneself, such as the SMTP test). */
export async function getAccountContact(
  pool: pg.Pool,
  input: { realm: Realm; userId: string },
): Promise<AccountContact | null> {
  return withRealmTx(pool, input.realm, async (c) => {
    const res = await c.query<AccountContact>(
      `SELECT username, email, display_name AS "displayName" FROM users WHERE id = $1`,
      [input.userId],
    );
    return res.rows[0] ?? null;
  });
}
