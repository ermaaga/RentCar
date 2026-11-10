// Route registry (docs/06-backend-api.md 3.2, SR-ACC-01, ABU-M0-13): every server action, route handler
// and page declares who may reach it. tests/security/route-registry.test.ts fails when an entry point
// exists without a row here (or a row has no entry point), and when a public one has no reason; the
// generated access matrix (tests/integration/access-matrix.test.ts) calls every protected action
// without a session and with the wrong role.

type Realm = "public" | "tenant" | "system" | "scheduler";
type MinRole = "operator" | "admin" | "systemadmin";
type WriteClass = "read" | "write" | "ro_allowed";

export interface EntryPoint {
  /** `action:<file>#<export>`, `route:<path>` or `page:<path>` (paths relative to src/app). */
  id: string;
  realm: Realm;
  minRole?: MinRole;
  writeClass: WriteClass;
  /** Required for public and scheduler entry points: why no session is needed. */
  reason?: string;
}

const action = (file: string, name: string) => `action:actions/${file}#${name}`;

const LOGOUT = "only clears the realm cookie and its own session row";
const PUBLIC_SITE = "public booking site: customers book without an account (FR-PUB-01)";
const PUBLIC_AUTH = "sign-in, set-password and reset flows run before a session exists";

export const ENTRY_POINTS: readonly EntryPoint[] = [
  // Auth (AUT-01..08): public until signed in, then the realm's own session.
  {
    id: action("auth", "loginSystemAction"),
    realm: "public",
    writeClass: "ro_allowed",
    reason: PUBLIC_AUTH,
  },
  {
    id: action("auth", "loginTenantAction"),
    realm: "public",
    writeClass: "ro_allowed",
    reason: PUBLIC_AUTH,
  },
  {
    id: action("auth", "redeemSystemAction"),
    realm: "public",
    writeClass: "ro_allowed",
    reason: PUBLIC_AUTH,
  },
  {
    id: action("auth", "redeemTenantAction"),
    realm: "public",
    writeClass: "ro_allowed",
    reason: PUBLIC_AUTH,
  },
  {
    id: action("auth", "logoutSystemAction"),
    realm: "public",
    writeClass: "ro_allowed",
    reason: LOGOUT,
  },
  {
    id: action("auth", "logoutTenantAction"),
    realm: "public",
    writeClass: "ro_allowed",
    reason: LOGOUT,
  },
  {
    id: action("auth", "changeSystemPasswordAction"),
    realm: "system",
    minRole: "systemadmin",
    writeClass: "ro_allowed",
  },
  {
    id: action("auth", "changeTenantPasswordAction"),
    realm: "tenant",
    minRole: "operator",
    writeClass: "ro_allowed",
  },
  {
    id: action("password-reset", "requestSystemResetAction"),
    realm: "public",
    writeClass: "ro_allowed",
    reason: PUBLIC_AUTH,
  },
  {
    id: action("password-reset", "requestTenantResetAction"),
    realm: "public",
    writeClass: "ro_allowed",
    reason: PUBLIC_AUTH,
  },
  // Operators (AUT-12..15): tenant admin only.
  {
    id: action("operators", "createOperatorAction"),
    realm: "tenant",
    minRole: "admin",
    writeClass: "write",
  },
  {
    id: action("operators", "setOperatorActiveAction"),
    realm: "tenant",
    minRole: "admin",
    writeClass: "write",
  },
  {
    id: action("operators", "reissueOperatorLinkAction"),
    realm: "tenant",
    minRole: "admin",
    writeClass: "write",
  },
  {
    id: action("operators", "updateOperatorAction"),
    realm: "tenant",
    minRole: "admin",
    writeClass: "write",
  },
  // Vehicles (FLT-01..04): tenant admin only.
  {
    id: action("vehicles", "createVehicleAction"),
    realm: "tenant",
    minRole: "admin",
    writeClass: "write",
  },
  {
    id: action("vehicles", "updateVehicleAction"),
    realm: "tenant",
    minRole: "admin",
    writeClass: "write",
  },
  {
    id: action("vehicles", "setMaintenanceAction"),
    realm: "tenant",
    minRole: "admin",
    writeClass: "write",
  },
  {
    id: action("vehicles", "removeVehicleAction"),
    realm: "tenant",
    minRole: "admin",
    writeClass: "write",
  },
  // Tenant SMTP (NTF-01/02): tenant admin only.
  {
    id: action("settings", "saveSmtpAction"),
    realm: "tenant",
    minRole: "admin",
    writeClass: "write",
  },
  {
    id: action("settings", "testSmtpAction"),
    realm: "tenant",
    minRole: "admin",
    writeClass: "write",
  },
  // Platform console (TEN-03..06, SUB-02, AUT-17): systemadmin only.
  {
    id: action("tenancy", "createTenantAction"),
    realm: "system",
    minRole: "systemadmin",
    writeClass: "write",
  },
  {
    id: action("tenancy", "setTenantStatusAction"),
    realm: "system",
    minRole: "systemadmin",
    writeClass: "write",
  },
  {
    id: action("tenancy", "renewSubscriptionAction"),
    realm: "system",
    minRole: "systemadmin",
    writeClass: "write",
  },
  {
    id: action("tenancy", "adminAccessLinkAction"),
    realm: "system",
    minRole: "systemadmin",
    writeClass: "write",
  },
  // Route handlers.
  {
    id: "route:api/healthz",
    realm: "public",
    writeClass: "read",
    reason: "liveness probe, no data",
  },
  {
    id: "route:api/readyz",
    realm: "public",
    writeClass: "read",
    reason: "readiness probe, status only",
  },
  {
    id: "route:api/jobs/run",
    realm: "scheduler",
    writeClass: "write",
    reason: "Bearer CRON_SECRET (JOB-01)",
  },
  // Pages.
  { id: "page:page", realm: "public", writeClass: "read", reason: "home page" },
  { id: "page:(system)/system/login", realm: "public", writeClass: "read", reason: PUBLIC_AUTH },
  { id: "page:(system)/system/activate", realm: "public", writeClass: "read", reason: PUBLIC_AUTH },
  {
    id: "page:(system)/system/forgot-password",
    realm: "public",
    writeClass: "read",
    reason: PUBLIC_AUTH,
  },
  {
    id: "page:(system)/system/reset-password",
    realm: "public",
    writeClass: "read",
    reason: PUBLIC_AUTH,
  },
  {
    id: "page:(system)/system/(console)",
    realm: "system",
    minRole: "systemadmin",
    writeClass: "read",
  },
  {
    id: "page:(system)/system/(console)/account",
    realm: "system",
    minRole: "systemadmin",
    writeClass: "read",
  },
  {
    id: "page:(system)/system/(console)/tenants/new",
    realm: "system",
    minRole: "systemadmin",
    writeClass: "read",
  },
  {
    id: "page:(system)/system/(console)/tenants/[slug]",
    realm: "system",
    minRole: "systemadmin",
    writeClass: "read",
  },
  {
    id: "page:(tenant)/[slug]/admin/login",
    realm: "public",
    writeClass: "read",
    reason: PUBLIC_AUTH,
  },
  {
    id: "page:(tenant)/[slug]/admin/activate",
    realm: "public",
    writeClass: "read",
    reason: PUBLIC_AUTH,
  },
  {
    id: "page:(tenant)/[slug]/admin/forgot-password",
    realm: "public",
    writeClass: "read",
    reason: PUBLIC_AUTH,
  },
  {
    id: "page:(tenant)/[slug]/admin/reset-password",
    realm: "public",
    writeClass: "read",
    reason: PUBLIC_AUTH,
  },
  // Public booking site (BKG-01..05): tenant from the slug only, open to anyone by design.
  { id: "page:(tenant)/[slug]", realm: "public", writeClass: "read", reason: PUBLIC_SITE },
  { id: "page:(tenant)/[slug]/vehicles", realm: "public", writeClass: "read", reason: PUBLIC_SITE },
  { id: "page:(tenant)/[slug]/book", realm: "public", writeClass: "read", reason: PUBLIC_SITE },
  {
    id: "page:(tenant)/[slug]/booking/[code]",
    realm: "public",
    writeClass: "read",
    reason: PUBLIC_SITE,
  },
  {
    id: "route:(tenant)/[slug]/booking/[code]/pdf",
    realm: "public",
    writeClass: "read",
    reason: PUBLIC_SITE,
  },
  {
    id: action("public-booking", "submitBookingAction"),
    realm: "public",
    writeClass: "write",
    reason: PUBLIC_SITE,
  },
  { id: "page:(tenant)/[slug]/admin", realm: "tenant", minRole: "operator", writeClass: "read" },
  {
    id: "page:(tenant)/[slug]/admin/account",
    realm: "tenant",
    minRole: "operator",
    writeClass: "read",
  },
  {
    id: "page:(tenant)/[slug]/admin/operators",
    realm: "tenant",
    minRole: "admin",
    writeClass: "read",
  },
  {
    id: "page:(tenant)/[slug]/admin/vehicles",
    realm: "tenant",
    minRole: "operator",
    writeClass: "read",
  },
  {
    id: "page:(tenant)/[slug]/admin/vehicles/[id]",
    realm: "tenant",
    minRole: "operator",
    writeClass: "read",
  },
  {
    id: "page:(tenant)/[slug]/admin/settings/email",
    realm: "tenant",
    minRole: "admin",
    writeClass: "read",
  },
];
