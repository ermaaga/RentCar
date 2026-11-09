"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getContainer } from "@/composition/container";
import {
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

async function signIn(
  realm: Parameters<typeof login>[1]["realm"],
  form: FormData,
): Promise<AuthFormState | { status: "ok" }> {
  const c = getContainer();
  const result = await login(c.pool, {
    realm,
    username: field(form, "username").trim().toLowerCase(),
    password: field(form, "password"),
    peppers: c.peppers,
    hmacKey: c.hmacKey,
    now: c.clock.now(),
  });
  if (result.status === "throttled") {
    return { status: "error", messageKey: "auth.login.throttled" };
  }
  if (result.status === "invalid") {
    return { status: "error", messageKey: "auth.login.invalid" };
  }
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
    await clearSession("tenant", tenantRealm(tenant.tenantId));
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
  const result = await redeemCredentialLink(c.pool, {
    realm,
    token: field(form, "token"),
    password,
    pepper: c.peppers[0] ?? "",
    now: c.clock.now(),
  });
  if (result.status !== "ok") {
    return { status: "error", messageKey: "auth.setPassword.invalid" };
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
): Promise<void> {
  const jar = await cookies();
  const spec = sessionCookie(cookieRealm, getContainer().secureCookies);
  const token = jar.get(spec.name)?.value;
  if (token) {
    await revokeSession(getContainer().pool, { realm, token });
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
