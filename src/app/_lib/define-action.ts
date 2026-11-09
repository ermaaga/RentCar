import type { MessageKey } from "@/i18n";
import type { ResolvedTenantRow } from "@/modules/tenancy";

import {
  requireSystemSession,
  requireTenantAdmin,
  requireTenantSession,
  tenantWriteRefusal,
} from "./session";

// defineAction for server actions (docs/06-backend-api.md 3.2, steps 4, 6 and 7): the one place that
// resolves the tenant from the route slug, requires the realm's session and minimum role (redirecting
// to the sign-in or home page otherwise) and applies the read-only policy before the handler runs.
// Rate limits and input parsing stay in each handler, after these checks. Every protected action in
// src/app/actions is built with tenantAction or systemAction (tests/security/route-registry.test.ts).

interface Session {
  userId: string;
  role: string;
}

export interface TenantActionContext {
  tenant: ResolvedTenantRow;
  session: Session;
}

interface TenantActionOptions<R> {
  minRole: "operator" | "admin";
  /** `read` and `ro_allowed` skip the read-only policy; `write` is refused while read-only. */
  writeClass: "read" | "write" | "ro_allowed";
  /** The handler's result for a refusal by the read-only policy. */
  onRefused: (messageKey: MessageKey) => NoInfer<R>;
}

export function tenantAction<A extends unknown[], R>(
  options: TenantActionOptions<R>,
  handler: (ctx: TenantActionContext, ...args: A) => Promise<R>,
): (slug: string, ...args: A) => Promise<R> {
  return async (slug: string, ...args: A): Promise<R> => {
    const found =
      options.minRole === "admin"
        ? await requireTenantAdmin(slug)
        : await requireTenantSession(slug);
    if (options.writeClass === "write") {
      const refusal = await tenantWriteRefusal(found.tenant);
      if (refusal) {
        return options.onRefused(refusal);
      }
    }
    return handler({ tenant: found.tenant, session: found.session }, ...args);
  };
}

export function systemAction<A extends unknown[], R>(
  handler: (ctx: { session: Session }, ...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const session = await requireSystemSession();
    return handler({ session }, ...args);
  };
}
