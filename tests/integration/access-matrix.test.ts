import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ENTRY_POINTS } from "../../src/app/_lib/entry-points";
import { cookiesMustBeSecure, sessionCookie } from "../../src/platform/http/session-cookie";

// Generated access matrix (ABU-M1-01/02/03, SR-ACC-01/02): every protected server action in the route
// registry is called with no session, with the wrong role, and with another tenant's session. Each call
// must be refused (redirect to the realm's sign-in or home page, or an error state) and change nothing.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-forwarded-for": "192.0.2.10" })),
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = jar.cookies.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: () => undefined,
      delete: () => undefined,
    }),
}));

const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
let admin: pg.Pool;
type Action = (...args: unknown[]) => Promise<unknown>;
const modules: Record<string, Record<string, Action>> = {};

const token = () => randomUUID() + randomUUID();
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest();

interface Tenant {
  id: string;
  slug: string;
  adminToken: string;
  operatorToken: string;
  operatorId: string;
}

async function user(tenantId: string | null, role: string): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const t = token();
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email, status, password_hash)
     VALUES ($1, $2, $3, $4, 'U', 'u@example.test', 'active', 'x')`,
    [id, tenantId, role, `${role}-${id.slice(0, 8)}`],
  );
  await admin.query(
    `INSERT INTO sessions (id, tenant_id, realm, user_id, token_hash, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour', now() + interval '1 hour')`,
    [randomUUID(), tenantId, tenantId ? "tenant" : "system", id, hash(t)],
  );
  return { id, token: t };
}

async function tenant(): Promise<Tenant> {
  const id = randomUUID();
  const slug = `mx-${id.slice(0, 8)}`;
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Matrix')", [id, slug]);
  await admin.query(
    `INSERT INTO subscriptions (id, tenant_id, max_vehicles, max_operators, start_date, end_date,
                                price_minor, price_currency)
     VALUES ($1, $2, 5, 5, current_date - 1, current_date + 300, 1, 'EUR')`,
    [randomUUID(), id],
  );
  const a = await user(id, "admin");
  const o = await user(id, "operator");
  return { id, slug, adminToken: a.token, operatorToken: o.token, operatorId: o.id };
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const idle = { status: "idle" };
const operatorFields = { displayName: "X", username: "matrixop", email: "x@example.test" };
const smtpFields = {
  host: "smtp.example.com",
  port: "587",
  security: "starttls",
  username: "u",
  password: "p",
  fromAddress: "n@example.test",
};

/** How to call each protected action against tenant `a` (and the system console). */
const INVOKERS: Record<string, (a: Tenant) => unknown[]> = {
  "action:actions/auth#changeSystemPasswordAction": () => [
    idle,
    form({ current: "x", password: "a long new passphrase", confirm: "a long new passphrase" }),
  ],
  "action:actions/auth#changeTenantPasswordAction": (a) => [
    a.slug,
    idle,
    form({ current: "x", password: "a long new passphrase", confirm: "a long new passphrase" }),
  ],
  "action:actions/operators#createOperatorAction": (a) => [a.slug, idle, form(operatorFields)],
  "action:actions/operators#setOperatorActiveAction": (a) => [a.slug, a.operatorId, false],
  "action:actions/operators#reissueOperatorLinkAction": (a) => [a.slug, a.operatorId],
  "action:actions/operators#updateOperatorAction": (a) => [
    a.slug,
    a.operatorId,
    idle,
    form({ displayName: "Changed", email: "changed@example.test" }),
  ],
  "action:actions/settings#saveSmtpAction": (a) => [a.slug, idle, form(smtpFields)],
  "action:actions/settings#testSmtpAction": (a) => [a.slug],
  "action:actions/tenancy#createTenantAction": () => [idle, form({ name: "x" })],
  "action:actions/tenancy#setTenantStatusAction": (a) => [a.slug, "suspended"],
  "action:actions/tenancy#renewSubscriptionAction": (a) => [
    a.slug,
    idle,
    form({ subscriptionId: randomUUID(), endDate: "2099-01-01" }),
  ],
  "action:actions/tenancy#adminAccessLinkAction": (a) => [a.slug],
};

const PROTECTED = ENTRY_POINTS.filter(
  (e) => e.id.startsWith("action:") && (e.realm === "tenant" || e.realm === "system"),
);

async function call(id: string, a: Tenant): Promise<{ redirect?: string; result?: unknown }> {
  const [file = "", name = ""] = id.slice("action:actions/".length).split("#");
  const fn = modules[file]?.[name];
  const invoke = INVOKERS[id];
  if (!fn || !invoke) throw new Error(`no invoker for ${id}`);
  try {
    return { result: await fn(...invoke(a)) };
  } catch (err) {
    const raw = (err as { digest?: unknown }).digest;
    const digest = typeof raw === "string" ? raw : "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw err;
    return { redirect: digest.split(";")[2] ?? "" };
  }
}

function refused(outcome: { redirect?: string; result?: unknown }, to: string): boolean {
  if (outcome.redirect !== undefined) return outcome.redirect === to;
  const status = (outcome.result as { status?: string } | undefined)?.status;
  return status === "error";
}

async function footprint(tenantId: string): Promise<string> {
  const res = await admin.query<{ f: string }>(
    `SELECT (SELECT count(*) FROM users WHERE tenant_id = $1)
          || ':' || (SELECT count(*) FROM users WHERE tenant_id = $1 AND status = 'active')
          || ':' || (SELECT count(*) FROM email_log WHERE tenant_id = $1)
          || ':' || (SELECT count(*) FROM tenant_smtp_configs WHERE tenant_id = $1)
          || ':' || (SELECT status FROM tenants WHERE id = $1)
          || ':' || (SELECT string_agg(display_name || email, ',' ORDER BY id) FROM users WHERE tenant_id = $1)
          || ':' || (SELECT count(*) FROM sessions WHERE tenant_id = $1) AS f`,
    [tenantId],
  );
  return res.rows[0]?.f ?? "";
}

// Same name the app uses for this environment (`__Host-` prefix outside local http).
const TENANT_COOKIE = sessionCookie(
  "tenant",
  cookiesMustBeSecure("ci", "http://localhost:3000"),
).name;

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  Object.assign(process.env, {
    APP_ENV: "ci",
    DATABASE_URL: appUrl,
    CRON_SECRET: "c".repeat(40),
    APP_ENCRYPTION_KEY: "e".repeat(40),
    PASSWORD_PEPPER: "p".repeat(40),
  });
  admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  for (const file of ["auth", "operators", "settings", "tenancy"]) {
    modules[file] = (await import(`../../src/app/actions/${file}.ts`)) as Record<string, Action>;
  }
  a = await tenant();
  b = await tenant();
}, 30_000);

afterAll(async () => {
  await admin.end();
});

describe.skipIf(!appUrl || !adminUrl)("access matrix: every protected action", () => {
  it("has an invoker for every protected action in the registry", () => {
    expect(PROTECTED.map((e) => e.id).filter((id) => !INVOKERS[id])).toEqual([]);
  });

  it("refuses every call without a session and changes nothing", async () => {
    const before = await footprint(a.id);
    for (const e of PROTECTED) {
      jar.cookies.clear();
      const login = e.realm === "system" ? "/system/login" : `/${a.slug}/admin/login`;
      expect(refused(await call(e.id, a), login), e.id).toBe(true);
    }
    expect(await footprint(a.id)).toBe(before);
  });

  it("refuses tenant actions with another tenant's admin session", async () => {
    const before = await footprint(a.id);
    for (const e of PROTECTED.filter((x) => x.realm === "tenant")) {
      jar.cookies.clear();
      jar.cookies.set(TENANT_COOKIE, b.adminToken);
      expect(refused(await call(e.id, a), `/${a.slug}/admin/login`), e.id).toBe(true);
    }
    expect(await footprint(a.id)).toBe(before);
  });

  it("refuses admin-only actions to an operator, and system actions to a tenant admin", async () => {
    const before = await footprint(a.id);
    for (const e of PROTECTED.filter((x) => x.minRole === "admin")) {
      jar.cookies.clear();
      jar.cookies.set(TENANT_COOKIE, a.operatorToken);
      const outcome = await call(e.id, a);
      expect(refused(outcome, `/${a.slug}/admin`), `${e.id} ${JSON.stringify(outcome)}`).toBe(true);
    }
    for (const e of PROTECTED.filter((x) => x.realm === "system")) {
      jar.cookies.clear();
      jar.cookies.set(TENANT_COOKIE, a.adminToken);
      expect(refused(await call(e.id, a), "/system/login"), e.id).toBe(true);
    }
    expect(await footprint(a.id)).toBe(before);
  });
});
