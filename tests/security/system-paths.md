# System-scope paths

Every caller of `withSystemTx` (scope `system`, docs/06-backend-api.md 2.3 rule 4). A review adds a row
for each new caller; the security review checks that none of them reads tenant customer or booking data.

| Caller | Purpose | Tables written |
|---|---|---|
| `src/modules/tenancy/infrastructure/provisioning.ts` `provisionTenant` | TEN-03 create tenant | tenants, tenant_settings, subscriptions, users, credential_tokens, platform_audit, audit_log |
