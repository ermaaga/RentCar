"use server";

import { revalidatePath } from "next/cache";

import { tenantActivationMail } from "@/app/_lib/credential-mail";
import { consume, securityEvent, tokenIssued } from "@/app/_lib/security";
import { requireTenantAdmin, tenantWriteRefusal } from "@/app/_lib/session";
import { getContainer } from "@/composition/container";
import type { MessageKey } from "@/i18n";
import {
  createOperator,
  createOperatorInput,
  recordCredentialDelivery,
  reissueOperatorLink,
  setOperatorActive,
  type IssuedOperatorLink,
} from "@/modules/auth";
import type { OperatorFormState } from "@/modules/auth/ui/add-operator-form";
import { sendTenantMail } from "@/modules/notifications";
import type { ConsoleActionState } from "@/modules/tenancy/ui/console-action-form";
import { RATE_LIMITS } from "@/platform/rate-limit/postgres";

// AUT-12/14/15 entry points (docs/06-backend-api.md 4.2.5): tenant admin only, blocked while the
// tenant is read-only, RL-09 on every issued link. The activation email goes through the tenant SMTP
// and is awaited; the link is never shown on screen (A-26) and never retried automatically.

type State = OperatorFormState;

function err(messageKey: MessageKey): { status: "error"; messageKey: MessageKey };
function err(messageKey: MessageKey, fields: readonly string[]): State;
function err(messageKey: MessageKey, fields?: readonly string[]) {
  return { status: "error" as const, messageKey, ...(fields ? { fields } : {}) };
}

async function guard(slug: string) {
  const found = await requireTenantAdmin(slug);
  const refusal = await tenantWriteRefusal(found.tenant);
  return { ...found, refusal };
}

/** Emails the activation link through the tenant SMTP and records the delivery outcome. */
async function deliver(slug: string, tenantId: string, link: IssuedOperatorLink): Promise<boolean> {
  const c = getContainer();
  const sent = await sendTenantMail(c, tenantId, tenantActivationMail(slug, link));
  await recordCredentialDelivery(c.pool, {
    tenantId,
    emailLogId: link.emailLogId,
    ok: sent.ok,
    ...(sent.ok ? {} : { category: sent.category }),
    now: c.clock.now(),
  });
  return sent.ok;
}

const CREATE_ERRORS = {
  USERNAME_TAKEN: err("operators.add.usernameTaken", ["username"]),
  PLAN_LIMIT_REACHED: err("operators.add.limitReached"),
} as const;

export async function createOperatorAction(slug: string, _: State, form: FormData): Promise<State> {
  const { tenant, session, refusal } = await guard(slug);
  if (refusal) return err(refusal);
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.slice(0, 254) : "";
  };
  const parsed = createOperatorInput.safeParse({
    displayName: text("displayName"),
    username: text("username"),
    email: text("email").trim(),
  });
  if (!parsed.success) {
    return err(
      "operators.add.invalid",
      parsed.error.issues.map((i) => i.path.join(".")),
    );
  }
  if (!(await consume(RATE_LIMITS.credentialIssued, `tenant:${tenant.slug}`, "tenant"))) {
    return err("operators.throttled");
  }
  const c = getContainer();
  const ctx = { tenantId: tenant.tenantId, actorUserId: session.userId, now: c.clock.now() };
  const created = await createOperator(c.pool, parsed.data, ctx);
  revalidatePath(`/${tenant.slug}/admin/operators`);
  if (!created.ok) return CREATE_ERRORS[created.code];
  await tokenIssued({
    realm: "tenant",
    reasonCode: "activation",
    actorId: session.userId,
    subjectTenantId: tenant.tenantId,
  });
  const sent = await deliver(tenant.slug, tenant.tenantId, created.link);
  return sent ? { status: "done", messageKey: "operators.add.sent" } : err("operators.add.notSent");
}

export async function setOperatorActiveAction(
  slug: string,
  id: string,
  active: boolean,
): Promise<ConsoleActionState> {
  const { tenant, session, refusal } = await guard(slug);
  if (refusal) return err(refusal);
  const c = getContainer();
  const result = await setOperatorActive(
    c.pool,
    { id, active },
    {
      tenantId: tenant.tenantId,
      now: c.clock.now(),
    },
  );
  revalidatePath(`/${tenant.slug}/admin/operators`);
  if (!result.ok) {
    return err(result.code === "NOT_FOUND" ? "operators.notFound" : "operators.add.limitReached");
  }
  if (result.sessionsRevoked > 0) {
    await securityEvent({
      event: "auth.session.revoked",
      realm: "tenant",
      outcome: "success",
      actorId: session.userId,
      subjectTenantId: tenant.tenantId,
      reasonCode: "operator_deactivated",
    });
  }
  return { status: "done", messageKey: active ? "operators.reactivated" : "operators.deactivated" };
}

export async function reissueOperatorLinkAction(
  slug: string,
  id: string,
): Promise<ConsoleActionState> {
  const { tenant, session, refusal } = await guard(slug);
  if (refusal) return err(refusal);
  if (!(await consume(RATE_LIMITS.credentialIssued, `tenant:${tenant.slug}`, "tenant"))) {
    return err("operators.throttled");
  }
  const c = getContainer();
  const issued = await reissueOperatorLink(
    c.pool,
    { id },
    {
      tenantId: tenant.tenantId,
      actorUserId: session.userId,
      now: c.clock.now(),
    },
  );
  if (!issued.ok) {
    revalidatePath(`/${tenant.slug}/admin/operators`);
    return err(issued.code === "NOT_FOUND" ? "operators.notFound" : "operators.notPending");
  }
  await tokenIssued({
    realm: "tenant",
    reasonCode: "activation",
    actorId: session.userId,
    subjectTenantId: tenant.tenantId,
  });
  const sent = await deliver(tenant.slug, tenant.tenantId, issued.link);
  revalidatePath(`/${tenant.slug}/admin/operators`);
  return sent ? { status: "done", messageKey: "operators.resent" } : err("operators.resendFailed");
}
