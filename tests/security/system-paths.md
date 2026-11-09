# System-scope paths

Every caller of `withSystemTx` (scope `system`, docs/06-backend-api.md 2.3 rule 4). A review adds a row
for each new caller; the security review checks that none of them reads tenant customer or booking data.

| Caller | Purpose | Tables written |
|---|---|---|
| `src/modules/tenancy/infrastructure/provisioning.ts` `provisionTenant` | TEN-03 create tenant | tenants, tenant_settings, subscriptions, users, credential_tokens, platform_audit, audit_log |
| `src/modules/tenancy/infrastructure/queries.ts` `resolveTenantBySlug` | TEN-01 slug to tenant (id, slug, name, status only) | none |
| `src/modules/tenancy/infrastructure/queries.ts` `listTenants` | TEN-09 console list (tenant, admin status, subscription end) | none |
| `src/modules/auth/infrastructure/realm-tx.ts` `withRealmTx` (system realm) | system login, sessions, systemadmin links | sessions, users, credential_tokens |
| `scripts/create-systemadmin.ts` | UC-AUT-20 bootstrap | users, credential_tokens |
