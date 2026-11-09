"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getContainer } from "@/composition/container";
import {
  changePassword,
  checkPassword,
  login,
  redeemCredentialLink,
  revokeSession,
  SYSTEM_REALM,
  tenantRealm,
} from "@/modules/auth";
import type { AuthFormState } from "@/modules/auth/ui/form-state";
import { resolveTenantBySlug } from "@/modules/tenancy";
import { sessionCookie, type CookieRealm } from "@/platform/http/session-cookie";
import { RATE_LIMITS } from "@/platform/rate-limit/postgres";

import { dispatchAfterResponse } from "@/app/_lib/outbox";
import { consume, limitReached, requestIp, securityEvent } from "@/app/_lib/security";

// Thin auth entry points (docs/06-backend-api.md AUT-01..05): parse the form, call the service,
// set or clear the realm cookie, redirect. Every refusal maps to one catalog key.

const MAX_INPUT = 512;

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.slice(0, MAX_INPUT) : "";
}

async function setSessionCookie(realm: CookieRealm, token: string): Promise<void> {
  const spec = sessionCookie(realm, getContainer().secureCookies);
  (await cookies()).set(spec.name, token, spec.options);
}

type AuthRealm = Parameters<typeof login>[1]["realm"];

const THROTTLED: AuthFormState = { status: "error", messageKey: "auth.login.throttled" };

function eventScope(realm: AuthRealm) {
  return {
    realm: realm.kind,
    subjectTenantId: realm.kind === "tenant" ? realm.tenantId : null,
  } as const;
}

type Outcome = "success" | "failure" | "refused";

function outboxScope(realm: AuthRealm) {
  return realm.kind === "tenant"
    ? ({ kind: "tenant", tenantId: realm.tenantId } as const)
    : ({ kind: "platform" } as const);
}

/** Emitter of security events bound to one realm and request IP. */
function realmEvents(realm: AuthRealm, ip?: string) {
  return (event: string, outcome: Outcome, extra: { reasonCode?: string; actorId?: string } = {}) =>
    securityEvent({ event, outcome, ...eventScope(realm), ...extra }, ip);
}

/**
 * AUT-01/02 with RL-04 (per account, inside `login`) and RL-05 (per IP: 20 failures / 15 min, system
 * realm 10). Every outcome is a security event; the answer stays generic (SR-AUT-03).
 */
async function signIn(realm: AuthRealm, form: FormData): Promise<AuthFormState | { status: "ok" }> {
  const c = getContainer();
  const ip = await requestIp();
  const ipRule = realm.kind === "system" ? RATE_LIMITS.loginIpSystem : RATE_LIMITS.loginIp;
  const emit = realmEvents(realm, ip);
  if (await limitReached(ipRule, ip, realm.kind)) {
    await emit("auth.login.throttled", "refused", { reasonCode: "ip" });
    return THROTTLED;
  }
  const result = await login(c.pool, {
    realm,
    username: field(form, "username").trim().toLowerCase(),
    password: field(form, "password"),
    peppers: c.peppers,
    hmacKey: c.hmacKey,
    now: c.clock.now(),
  });
  if (result.status === "throttled") {
    await emit("auth.login.throttled", "refused", { reasonCode: "account" });
    return THROTTLED;
  }
  if (result.status === "invalid") {
    await consume(ipRule, ip, realm.kind);
    await emit("auth.login.failure", "failure", { reasonCode: result.reason });
    return { status: "error", messageKey: "auth.login.invalid" };
  }
  await emit("auth.login.success", "success", { actorId: result.userId });
  await setSessionCookie(realm.kind, result.token);
  return { status: "ok" };
}

export async function loginSystemAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const outcome = await signIn(SYSTEM_REALM, form);
  if (outcome.status !== "ok") {
    return outcome;
  }
  redirect("/system");
}

export async function loginTenantAction(
  slug: string,
  _: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const tenant = await resolveTenantBySlug(getContainer().pool, slug);
  if (!tenant) {
    return { status: "error", messageKey: "auth.login.invalid" };
  }
  const outcome = await signIn(tenantRealm(tenant.tenantId), form);
  if (outcome.status !== "ok") {
    return outcome;
  }
  if (tenant.status !== "active") {
    await clearSession("tenant", tenantRealm(tenant.tenantId), false);
    await securityEvent({
      event: "auth.login.failure",
      outcome: "refused",
      reasonCode: "tenant_unavailable",
      ...eventScope(tenantRealm(tenant.tenantId)),
    });
    return { status: "error", messageKey: "auth.login.unavailable" };
  }
  redirect(`/${tenant.slug}/admin`);
}

function passwordProblem(password: string, confirm: string): AuthFormState | undefined {
  const policy = checkPassword(password);
  if (!policy.ok) {
    const tooLong = policy.problems.includes("too_long");
    return {
      status: "error",
      messageKey: tooLong ? "auth.setPassword.tooLong" : "auth.setPassword.tooShort",
    };
  }
  return password === confirm
    ? undefined
    : { status: "error", messageKey: "auth.setPassword.mismatch" };
}

/** AUT-05 with RL-08 (failed redemptions per IP: 10/h). */
async function setPassword(
  realm: Parameters<typeof redeemCredentialLink>[1]["realm"],
  form: FormData,
): Promise<AuthFormState | { status: "ok"; purpose: string }> {
  const password = field(form, "password");
  const problem = passwordProblem(password, field(form, "confirm"));
  if (problem) {
    return problem;
  }
  const c = getContainer();
  const ip = await requestIp();
  const emit = realmEvents(realm, ip);
  if (await limitReached(RATE_LIMITS.setPasswordIp, ip, realm.kind)) {
    return { status: "error", messageKey: "auth.login.throttled" };
  }
  const result = await redeemCredentialLink(c.pool, {
    realm,
    token: field(form, "token"),
    password,
    pepper: c.peppers[0] ?? "",
    now: c.clock.now(),
  });
  if (result.status !== "ok") {
    if (result.status === "invalid") {
      await consume(RATE_LIMITS.setPasswordIp, ip, realm.kind);
    }
    await emit("auth.token.rejected", "failure", { reasonCode: result.status });
    return { status: "error", messageKey: "auth.setPassword.invalid" };
  }
  await emit("auth.token.redeemed", "success", { reasonCode: result.purpose });
  if (result.purpose === "password_reset") {
    dispatchAfterResponse(outboxScope(realm));
  }
  if (result.sessionToken) {
    await setSessionCookie(realm.kind, result.sessionToken);
  }
  return { status: "ok", purpose: result.purpose };
}

export async function redeemSystemAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const outcome = await setPassword(SYSTEM_REALM, form);
  if (outcome.status !== "ok") {
    return outcome;
  }
  redirect(outcome.purpose === "activation" ? "/system" : "/system/login?passwordSet=1");
}

export async function redeemTenantAction(
  slug: string,
  _: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const tenant = await resolveTenantBySlug(getContainer().pool, slug);
  if (!tenant) {
    return { status: "error", messageKey: "auth.setPassword.invalid" };
  }
  const outcome = await setPassword(tenantRealm(tenant.tenantId), form);
  if (outcome.status !== "ok") {
    return outcome;
  }
  const home = `/${tenant.slug}/admin`;
  redirect(outcome.purpose === "activation" ? home : `${home}/login?passwordSet=1`);
}

async function clearSession(
  cookieRealm: CookieRealm,
  realm: Parameters<typeof revokeSession>[1]["realm"],
  asLogout = true,
): Promise<void> {
  const jar = await cookies();
  const spec = sessionCookie(cookieRealm, getContainer().secureCookies);
  const token = jar.get(spec.name)?.value;
  if (token) {
    await revokeSession(getContainer().pool, { realm, token });
    if (asLogout) {
      await securityEvent({ event: "auth.logout", outcome: "success", ...eventScope(realm) });
    }
  }
  jar.delete({ name: spec.name, path: "/" });
}

export async function logoutSystemAction(): Promise<void> {
  await clearSession("system", SYSTEM_REALM);
  redirect("/system/login");
}

export async function logoutTenantAction(slug: string): Promise<void> {
  const tenant = await resolveTenantBySlug(getContainer().pool, slug);
  if (tenant) {
    await clearSession("tenant", tenantRealm(tenant.tenantId));
  }
  redirect(`/${slug}/admin/login`);
}

async function rotatePassword(
  cookieRealm: CookieRealm,
  realm: Parameters<typeof changePassword>[1]["realm"],
  form: FormData,
): Promise<AuthFormState> {
  const password = field(form, "password");
  const problem = passwordProblem(password, field(form, "confirm"));
  if (problem) {
    return problem;
  }
  const c = getContainer();
  const spec = sessionCookie(cookieRealm, c.secureCookies);
  const result = await changePassword(c.pool, {
    realm,
    sessionToken: (await cookies()).get(spec.name)?.value ?? "",
    currentPassword: field(form, "current"),
    newPassword: password,
    peppers: c.peppers,
    hmacKey: c.hmacKey,
    now: c.clock.now(),
  });
  if (result.status === "ok") {
    await securityEvent({
      event: "auth.password.changed",
      outcome: "success",
      ...eventScope(realm),
    });
    dispatchAfterResponse(outboxScope(realm));
    await setSessionCookie(cookieRealm, result.sessionToken);
    return { status: "done", messageKey: "auth.account.changed" };
  }
  if (result.status === "throttled") {
    return { status: "error", messageKey: "auth.login.throttled" };
  }
  if (result.status === "policy_failed") {
    return { status: "error", messageKey: "auth.setPassword.tooShort" };
  }
  return { status: "error", messageKey: "auth.account.currentInvalid" };
}

export async function changeSystemPasswordAction(
  _: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  return rotatePassword("system", SYSTEM_REALM, form);
}

export async function changeTenantPasswordAction(
  slug: string,
  _: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const tenant = await resolveTenantBySlug(getContainer().pool, slug);
  if (!tenant) {
    return { status: "error", messageKey: "auth.account.currentInvalid" };
  }
  return rotatePassword("tenant", tenantRealm(tenant.tenantId), form);
}
