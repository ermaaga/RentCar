import { randomUUID } from "node:crypto";
import type pg from "pg";

import { withSystemTx } from "../../../platform/db/system-tx";
import { issueCredentialLink } from "../../auth";
import type { CreateTenantInput } from "../application/create-tenant-input";
import { checkSlug } from "../domain/slug";

// TEN-03 createTenant (docs/06-backend-api.md 6.1): one system-scope transaction creates the tenant,
// its default settings, the first subscription, the pending admin and its activation link, and the
// audit rows. Slug taken or reserved => nothing is created.

export interface ProvisionContext {
  actorUserId: string;
  now: Date;
  requestId?: string;
}

type ProvisionError =
  "SLUG_INVALID" | "SLUG_RESERVED" | "SLUG_TAKEN" | "SUBSCRIPTION_INVALID_PERIOD";

export type ProvisionResult =
  | { ok: true; tenantId: string; slug: string; adminUserId: string; activationToken: string }
  | { ok: false; code: ProvisionError };

interface Ids {
  tenantId: string;
  adminUserId: string;
}

async function insertTenant(c: pg.ClientBase, ids: Ids, input: CreateTenantInput, now: Date) {
  await c.query(
    `INSERT INTO tenants (id, slug, name, country_code, time_zone, currency, dpa_signed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)`,
    [ids.tenantId, input.slug, input.name, input.countryCode, input.timeZone, input.currency, now],
  );
  const a = input.address;
  await c.query(
    `INSERT INTO tenant_settings (tenant_id, title, short_description, contact_email, contact_phone,
       address_street, address_postal_code, address_city, address_country_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      ids.tenantId,
      input.title,
      input.shortDescription ?? null,
      input.contact.email,
      input.contact.phone,
      a?.street ?? null,
      a?.postalCode ?? null,
      a?.city ?? null,
      a?.countryCode ?? null,
    ],
  );
}

async function insertSubscription(c: pg.ClientBase, ids: Ids, input: CreateTenantInput) {
  const s = input.subscription;
  await c.query(
    `INSERT INTO subscriptions (id, tenant_id, max_vehicles, max_operators, start_date, end_date, price_minor, price_currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      ids.tenantId,
      s.maxVehicles,
      s.maxOperators,
      s.startDate,
      s.endDate,
      s.priceMinor,
      s.priceCurrency,
    ],
  );
}

async function insertAdmin(c: pg.ClientBase, ids: Ids, input: CreateTenantInput) {
  await c.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email, status)
     VALUES ($1, $2, 'admin', $3, $4, $5, 'pending')`,
    [
      ids.adminUserId,
      ids.tenantId,
      input.admin.username,
      input.admin.displayName,
      input.admin.email,
    ],
  );
}

async function insertAudit(
  c: pg.ClientBase,
  ids: Ids,
  input: CreateTenantInput,
  ctx: ProvisionContext,
) {
  await c.query(
    `INSERT INTO platform_audit (id, created_at, actor_user_id, action, subject_tenant_id, entity_ref, request_id)
     VALUES ($1, $2, $3, 'tenant.created', $4, $5, $6)`,
    [randomUUID(), ctx.now, ctx.actorUserId, ids.tenantId, input.slug, ctx.requestId ?? null],
  );
  // The tenant's own audit row is written under its tenant scope (tenant_insert policy), still in this tx.
  await c.query("SELECT set_config('app.tenant_id', $1, true)", [ids.tenantId]);
  await c.query(
    `INSERT INTO audit_log (id, tenant_id, created_at, actor_type, actor_user_id, actor_role, action, entity_type, entity_id, request_id)
     VALUES ($1, $2, $3, 'user', $4, 'systemadmin', 'tenant.created', 'tenant', $2, $5)`,
    [randomUUID(), ids.tenantId, ctx.now, ctx.actorUserId, ctx.requestId ?? null],
  );
  await c.query("SELECT set_config('app.tenant_id', '', true)");
}

async function slugTombstoned(c: pg.ClientBase, slug: string, now: Date): Promise<boolean> {
  const res = await c.query(
    "SELECT 1 FROM slug_tombstone WHERE slug = $1 AND reserved_until > $2",
    [slug, now],
  );
  return (res.rowCount ?? 0) > 0;
}

class ProvisionRefused extends Error {
  constructor(readonly code: ProvisionError) {
    super(code);
  }
}

function mapDbError(err: unknown): ProvisionError | undefined {
  const e = err as { code?: string; constraint?: string };
  if (e.code === "23505" && e.constraint === "tenants_slug_key") {
    return "SLUG_TAKEN";
  }
  if (e.code === "23514" && e.constraint === "subscriptions_dates") {
    return "SUBSCRIPTION_INVALID_PERIOD";
  }
  return undefined;
}

async function provisionInTx(
  c: pg.ClientBase,
  input: CreateTenantInput,
  ctx: ProvisionContext,
): Promise<ProvisionResult> {
  if (await slugTombstoned(c, input.slug, ctx.now)) {
    throw new ProvisionRefused("SLUG_RESERVED");
  }
  const ids = { tenantId: randomUUID(), adminUserId: randomUUID() };
  await insertTenant(c, ids, input, ctx.now);
  await insertSubscription(c, ids, input);
  await insertAdmin(c, ids, input);
  const activationToken = await issueCredentialLink(c, {
    tenantId: ids.tenantId,
    userId: ids.adminUserId,
    purpose: "activation",
    now: ctx.now,
  });
  await insertAudit(c, ids, input, ctx);
  return { ok: true, slug: input.slug, activationToken, ...ids };
}

/** Creates a tenant with its first admin. The caller sends the activation link after commit. */
export async function provisionTenant(
  pool: pg.Pool,
  input: CreateTenantInput,
  ctx: ProvisionContext,
): Promise<ProvisionResult> {
  const slug = checkSlug(input.slug);
  if (!slug.ok) {
    return { ok: false, code: slug.reason === "reserved" ? "SLUG_RESERVED" : "SLUG_INVALID" };
  }
  if (input.subscription.endDate < input.subscription.startDate) {
    return { ok: false, code: "SUBSCRIPTION_INVALID_PERIOD" };
  }
  try {
    return await withSystemTx(pool, (c) => provisionInTx(c, input, ctx));
  } catch (err) {
    const code = err instanceof ProvisionRefused ? err.code : mapDbError(err);
    if (code) {
      return { ok: false, code };
    }
    throw err;
  }
}
