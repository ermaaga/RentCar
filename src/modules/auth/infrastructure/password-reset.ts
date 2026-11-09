import type pg from "pg";

import { realmTenantId, type Realm } from "../domain/realm";
import { issueCredentialLink } from "./credential-links";
import { withRealmTx } from "./realm-tx";

// AUT-06/07 (docs/06-backend-api.md 4.2.3). Runs after the uniform response: finds at most 3 active
// accounts of the realm whose username or email matches, and issues a reset link for each. The caller
// sends the emails; nothing here reveals whether an account matched.

const MAX_ACCOUNTS = 3;

export interface ResetRecipient {
  userId: string;
  role: "admin" | "operator" | "systemadmin";
  username: string;
  displayName: string;
  email: string;
  token: string;
}

interface AccountRow {
  id: string;
  role: ResetRecipient["role"];
  username: string;
  display_name: string;
  email: string;
}

export async function issuePasswordResets(
  pool: pg.Pool,
  input: { realm: Realm; identifier: string; now: Date },
): Promise<ResetRecipient[]> {
  const identifier = input.identifier.trim().toLowerCase();
  if (identifier.length === 0 || identifier.length > 254) {
    return [];
  }
  return withRealmTx(pool, input.realm, async (client) => {
    const res = await client.query<AccountRow>(
      `SELECT id, role, username, display_name, email FROM users
        WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND status = 'active'
          AND (role = 'systemadmin') = ($1::uuid IS NULL)
          AND (username = $2 OR lower(email) = $2)
        ORDER BY created_at LIMIT ${String(MAX_ACCOUNTS)}`,
      [realmTenantId(input.realm), identifier],
    );
    const recipients: ResetRecipient[] = [];
    for (const row of res.rows) {
      const token = await issueCredentialLink(client, {
        realm: input.realm,
        userId: row.id,
        purpose: "password_reset",
        now: input.now,
      });
      recipients.push({
        userId: row.id,
        role: row.role,
        username: row.username,
        displayName: row.display_name,
        email: row.email,
        token,
      });
    }
    return recipients;
  });
}
