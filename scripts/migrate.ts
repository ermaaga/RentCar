// Migration runner (M0). Applies drizzle/*.sql in lexical order, each file once, under an advisory lock.
// Connects as rentcar_migrator and switches to rentcar_owner for the work. Fails closed: any error
// exits non-zero, a file is applied in its own transaction, and an applied file must never change.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const LOCK_KEY = "rentcar:migrations";
const defaultDir = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

export interface Migration {
  id: string;
  sql: string;
  checksum: string;
}

export function listMigrations(dir: string = defaultDir): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((id) => {
      const sql = readFileSync(join(dir, id), "utf8");
      return { id, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

async function applyOne(client: pg.Client, m: Migration): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(m.sql);
    await client.query("INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)", [
      m.id,
      m.checksum,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`migration ${m.id} failed: ${reason}`, { cause: err });
  }
}

async function appliedChecksums(client: pg.Client): Promise<Map<string, string>> {
  const res = await client.query<{ id: string; checksum: string }>(
    "SELECT id, checksum FROM schema_migrations",
  );
  return new Map(res.rows.map((r) => [r.id, r.checksum]));
}

async function runPending(client: pg.Client, dir: string): Promise<string[]> {
  const done = await appliedChecksums(client);
  const applied: string[] = [];
  for (const m of listMigrations(dir)) {
    const known = done.get(m.id);
    if (known === undefined) {
      await applyOne(client, m);
      applied.push(m.id);
    } else if (known !== m.checksum) {
      throw new Error(`migration ${m.id} was modified after being applied`);
    }
  }
  return applied;
}

export async function migrate(
  connectionString: string,
  dir: string = defaultDir,
): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
    await client.query("SET ROLE rentcar_owner");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    return await runPending(client, dir);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))").catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) {
    console.error("migrate: DIRECT_DATABASE_URL is required");
    process.exit(1);
  }
  try {
    const applied = await migrate(url);
    console.log(
      `migrate: applied ${String(applied.length)} migration(s): ${applied.join(", ") || "none"}`,
    );
  } catch (err) {
    console.error(`migrate: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
