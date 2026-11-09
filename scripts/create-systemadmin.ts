// Bootstrap the platform owner account (docs/06-backend-api.md 4.2.6, UC-AUT-20, SR-AUT-13).
// Creates a pending systemadmin and an activation link, and prints the link once to stdout: the
// person running this CLI is the owner. Usage:
//   SYSTEMADMIN_USERNAME=owner SYSTEMADMIN_EMAIL=owner@example.com node dist-scripts/create-systemadmin.mjs
import { randomUUID } from "node:crypto";
import pg from "pg";

import { credentialPath, issueCredentialLink, SYSTEM_REALM } from "../src/modules/auth";
import { withSystemTx } from "../src/platform/db/system-tx";

interface BootstrapInput {
  username: string;
  email: string;
  displayName: string;
}

export function readBootstrapInput(env: Record<string, string | undefined>): BootstrapInput {
  const username = (env.SYSTEMADMIN_USERNAME ?? "").toLowerCase();
  const email = env.SYSTEMADMIN_EMAIL ?? "";
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw new Error("SYSTEMADMIN_USERNAME must be 3 to 40 of a-z 0-9 . _ -");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("SYSTEMADMIN_EMAIL must be an email address");
  }
  return { username, email, displayName: env.SYSTEMADMIN_DISPLAY_NAME ?? "Platform owner" };
}

/** Creates the pending systemadmin and returns the plaintext activation token. */
export async function createSystemadmin(
  pool: pg.Pool,
  input: BootstrapInput,
  now: Date,
): Promise<string> {
  return withSystemTx(pool, async (client) => {
    const userId = randomUUID();
    await client.query(
      `INSERT INTO users (id, tenant_id, role, username, display_name, email, status)
       VALUES ($1, NULL, 'systemadmin', $2, $3, $4, 'pending')`,
      [userId, input.username, input.displayName, input.email],
    );
    return issueCredentialLink(client, { realm: SYSTEM_REALM, userId, purpose: "activation", now });
  });
}

async function main(): Promise<void> {
  const input = readBootstrapInput(process.env);
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const token = await createSystemadmin(pool, input, new Date());
    console.log(`systemadmin "${input.username}" created (pending).`);
    console.log(`Activation link (valid 24 hours, shown once):`);
    console.log(`${baseUrl}${credentialPath({ kind: "system" }, "activation", token)}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err: unknown) => {
    const e = err as { code?: string; message?: string };
    console.error(e.code === "23505" ? "username already exists" : (e.message ?? "failed"));
    process.exit(1);
  });
}
