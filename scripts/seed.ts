// Idempotent development seed. Refuses to run outside local and ci, so no fixture or demo credential
// can reach a production-like environment (03b section 9, 11-devops 2.1, 06-backend-api 4.2.6).
// Creates the platform owner `owner` with a known development password, so the console is usable
// right after `docker compose up` and the E2E suite can sign in.
import { randomUUID } from "node:crypto";
import pg from "pg";

import { hashPassword } from "../src/platform/crypto/password";
import { withSystemTx } from "../src/platform/db/system-tx";

const ALLOWED_ENVS = new Set(["local", "ci"]);
const DEFAULT_PASSWORD = "INSECURE_DEV_owner_password";

export function assertSeedAllowed(appEnv: string | undefined): void {
  if (appEnv === undefined || !ALLOWED_ENVS.has(appEnv)) {
    throw new Error(`seed refused: APP_ENV must be "local" or "ci" (got "${appEnv ?? "unset"}")`);
  }
}

async function seedOwner(pool: pg.Pool, pepper: string, password: string): Promise<boolean> {
  const hash = await hashPassword(password, pepper);
  return withSystemTx(pool, async (c) => {
    const res = await c.query(
      `INSERT INTO users (id, tenant_id, role, username, display_name, email, password_hash, status, password_changed_at)
       VALUES ($1, NULL, 'systemadmin', 'owner', 'Platform owner', 'owner@rentcar.localhost', $2, 'active', now())
       ON CONFLICT (username) WHERE tenant_id IS NULL DO NOTHING`,
      [randomUUID(), hash],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

async function main(): Promise<void> {
  assertSeedAllowed(process.env.APP_ENV);
  const pepper = process.env.PASSWORD_PEPPER ?? "";
  if (pepper.length < 32) {
    throw new Error("seed refused: PASSWORD_PEPPER must be set");
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const created = await seedOwner(
      pool,
      pepper,
      process.env.SEED_OWNER_PASSWORD ?? DEFAULT_PASSWORD,
    );
    console.log(created ? "seed: created systemadmin 'owner'" : "seed: systemadmin 'owner' exists");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
