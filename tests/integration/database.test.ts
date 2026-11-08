import pg from "pg";
import { describe, expect, it } from "vitest";

import { migrate } from "../../scripts/migrate";

// Runs against a real Postgres (compose locally, service container in CI).
// Skipped when the variables are not set, so unit runs stay fast and dependency-free.
interface DbUrls {
  admin: string;
  migrator: string;
  app: string;
}

function readUrls(): DbUrls | undefined {
  const admin = process.env.TEST_DATABASE_ADMIN_URL;
  const migrator = process.env.TEST_DIRECT_DATABASE_URL;
  const app = process.env.TEST_DATABASE_URL;
  return admin && migrator && app ? { admin, migrator, app } : undefined;
}

async function scalar<T>(url: string, sql: string): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query<Record<string, T>>(sql);
    return Object.values(res.rows[0] ?? {})[0] as T;
  } finally {
    await client.end();
  }
}

const urls = readUrls();

describe.skipIf(!urls)("database roles and migrations", () => {
  const u = urls ?? { admin: "", migrator: "", app: "" };

  it("applies migrations idempotently and records them in the ledger", async () => {
    await migrate(u.migrator);
    const again = await migrate(u.migrator);
    expect(again).toEqual([]);
    const count = await scalar<number>(u.admin, "SELECT count(*)::int FROM schema_migrations");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("runtime role is not a superuser and cannot bypass RLS", async () => {
    const privileged = await scalar<boolean>(
      u.app,
      "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(privileged).toBe(false);
  });

  it("runtime role cannot create objects in the public schema", async () => {
    const canCreate = await scalar<boolean>(
      u.app,
      "SELECT has_schema_privilege(current_user, 'public', 'CREATE')",
    );
    expect(canCreate).toBe(false);
  });

  it("ABU-M0-01: runtime role owns no objects and cannot create roles", async () => {
    const owned = await scalar<number>(
      u.app,
      "SELECT count(*)::int FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = current_user",
    );
    const canCreateRole = await scalar<boolean>(
      u.app,
      "SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user",
    );
    expect(owned).toBe(0);
    expect(canCreateRole).toBe(false);
  });
});

describe.skipIf(!urls)("database ownership", () => {
  const u = urls ?? { admin: "", migrator: "", app: "" };

  it("database is owned by the owner role, not by the bootstrap superuser", async () => {
    const owner = await scalar<string>(
      u.admin,
      "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()",
    );
    expect(owner).toBe("rentcar_owner");
  });
});
