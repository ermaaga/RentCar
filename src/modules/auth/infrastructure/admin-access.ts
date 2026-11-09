import { randomUUID } from "node:crypto";
import type pg from "pg";

import { withSystemTx } from "../../../platform/db/system-tx";
import { tenantRealm } from "../domain/realm";
import { enqueueAccountNotice } from "./account-notice";
import { issueCredentialLink } from "./credential-links";

// AUT-17 issueAdminAccessLink (docs/06-backend-api.md 4.2.5). Same admin, new access: the password is
// cleared, every session ends, the account goes back to pending and a fresh activation link is issued.
// One transaction in the system scope, with the platform and tenant audit rows.

export interface AdminAccessLink {
  tenantId: string;
  slug: string;
  username: string;
  displayName: string;
  email: string;
  token: string;
}

interface AdminRow {
  tenant_id: string;
  id: string;
  username: string;
  display_name: string;
  email: string;
}

/** Audit rows plus the notice to the admin's address (SY-06, SR-AUT-10), in the reset transaction. */
async function auditReset(c: pg.ClientBase, admin: AdminRow, actorUserId: string, now: Date) {
  await enqueueAccountNotice(c, { userId: admin.id, template: "notice.admin_access_changed", now });
  await c.query(
    `INSERT INTO platform_audit (id, created_at, actor_user_id, action, subject_tenant_id, entity_ref)
     VALUES ($1, $2, $3, 'admin.reset', $4, $5)`,
    [randomUUID(), now, actorUserId, admin.tenant_id, admin.id],
  );
  await c.query("SELECT set_config('app.tenant_id', $1, true)", [admin.tenant_id]);
  await c.query(
    `INSERT INTO audit_log (id, tenant_id, created_at, actor_type, actor_user_id, actor_role, action, entity_type, entity_id)
     VALUES ($1, $2, $3, 'user', $4, 'systemadmin', 'admin_account.reset', 'user', $5)`,
    [randomUUID(), admin.tenant_id, now, actorUserId, admin.id],
  );
  await c.query("SELECT set_config('app.tenant_id', '', true)");
}

export async function issueAdminAccessLink(
  pool: pg.Pool,
  input: { slug: string; actorUserId: string; now: Date },
): Promise<AdminAccessLink | null> {
  return withSystemTx(pool, async (c) => {
    const res = await c.query<AdminRow>(
      `SELECT u.tenant_id, u.id, u.username, u.display_name, u.email
         FROM users u JOIN tenants t ON t.id = u.tenant_id
        WHERE t.slug = $1 AND t.status <> 'deleted' AND u.role = 'admin' AND u.status IN ('pending', 'active')
        FOR UPDATE OF u`,
      [input.slug],
    );
    const admin = res.rows[0];
    if (!admin) {
      return null;
    }
    await c.query(
      `UPDATE users SET password_hash = NULL, status = 'pending', password_changed_at = $2, updated_at = $2
        WHERE id = $1`,
      [admin.id, input.now],
    );
    await c.query("DELETE FROM sessions WHERE user_id = $1", [admin.id]);
    // created_by_user_id stays NULL: its foreign key is tenant-scoped and the actor is the systemadmin.
    const token = await issueCredentialLink(c, {
      realm: tenantRealm(admin.tenant_id),
      userId: admin.id,
      purpose: "activation",
      now: input.now,
    });
    await auditReset(c, admin, input.actorUserId, input.now);
    return {
      tenantId: admin.tenant_id,
      slug: input.slug,
      username: admin.username,
      displayName: admin.display_name,
      email: admin.email,
      token,
    };
  });
}
