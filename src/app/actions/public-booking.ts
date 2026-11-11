"use server";

import { redirect } from "next/navigation";

import { dispatchAfterResponse } from "@/app/_lib/outbox";
import { loadPublicTenant, type PublicTenant } from "@/app/_lib/public-tenant";
import { consume, requestIp } from "@/app/_lib/security";
import { getContainer } from "@/composition/container";
import { checkFormToken, publicBookingInput, submitPublicBooking } from "@/modules/booking";
import type { SubmitResult } from "@/modules/booking";
import type { BookingErrorCode, BookingFormState } from "@/modules/booking/ui/booking-form-state";
import { createLogger } from "@/platform/logging";
import { RATE_LIMITS } from "@/platform/rate-limit/postgres";

// BKG-03 entry point (docs/06-backend-api.md): public by design (no account), the tenant comes from
// the slug only. Order: tenant can take bookings, honeypot and form token (bots get the silent decoy),
// RL-02 per tenant and IP, strict schema, then one tenant transaction. Success redirects to BKG-04.

const DECOY: BookingFormState = { status: "received" };
// Events of docs/12-osservabilita.md (booking SLI): ids and codes only, never customer data.
const logger = createLogger({ service: "rentcar-web" });

/** An error code safe to log: Postgres SQLSTATE or the error name, never the message or detail. */
function errorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return err instanceof Error ? err.name : "unknown";
}
const fail = (
  code: BookingErrorCode,
  extra: Partial<Extract<BookingFormState, { status: "error" }>> = {},
) => ({ status: "error", code, ...extra }) as const;

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);
}

function formValues(form: FormData): Record<string, unknown> {
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v.slice(0, 600) : "";
  };
  return {
    formToken: text("formToken"),
    vehicleId: text("vehicleId"),
    pickup: text("pickup"),
    return: text("return"),
    expectedTotalMinor: text("expectedTotalMinor"),
    firstName: text("firstName"),
    lastName: text("lastName"),
    phone: text("phone"),
    email: text("email"),
    acknowledge: form.get("acknowledge") === "on",
  };
}

function outcome(result: SubmitResult, tenant: PublicTenant): BookingFormState {
  const tenant_id = tenant.tenantId;
  if (result.ok && !result.replayed) {
    logger.info({ event: "booking.created", tenant_id, entity_id: result.code, outcome: "public" });
  } else if (!result.ok && result.code === "VEHICLE_TAKEN") {
    logger.warn({ event: "booking.conflict", tenant_id }, "booking.conflict");
  }
  if (result.ok) {
    if (!result.replayed) dispatchAfterResponse({ kind: "tenant", tenantId: tenant.tenantId });
    redirect(`/${tenant.slug}/booking/${result.code}`);
  }
  if (result.code === "PRICE_CHANGED") {
    return fail("PRICE_CHANGED", { total: money(result.totalMinor, tenant.currency) });
  }
  if (result.code === "PHONE_INVALID") return fail("PHONE_INVALID", { fields: ["phone"] });
  const known: readonly string[] = [
    "VEHICLE_TAKEN",
    "PHONE_BOOKING_LIMIT",
    "IDEMPOTENCY_KEY_REUSED",
  ];
  return fail(known.includes(result.code) ? (result.code as BookingErrorCode) : "EXPIRED");
}

type SubmitInput = Parameters<typeof submitPublicBooking>[1];
type SubmitCtx = Parameters<typeof submitPublicBooking>[2];

/** One booking attempt, logged for the SLI; an unexpected error is logged by code and becomes null. */
async function submit(input: SubmitInput, ctx: SubmitCtx): Promise<SubmitResult | null> {
  logger.info({ event: "public.booking.submitted", tenant_id: ctx.tenantId });
  return submitPublicBooking(getContainer().pool, input, ctx).catch((err: unknown) => {
    const fields = { tenant_id: ctx.tenantId, error_code: errorCode(err) };
    logger.error({ event: "booking.failed", ...fields }, "booking.failed");
    return null;
  });
}

/** RL-02 per tenant and IP; fails closed (SR-RL-04, ABU-M2-02) with a friendly "try again". */
async function submitLimit(tenantId: string): Promise<"FAILED" | "RATE_LIMITED" | null> {
  const identity = `${tenantId}:${await requestIp()}`;
  const allowed = await consume(RATE_LIMITS.publicBookingSubmit, identity, "public").catch(
    () => null,
  );
  if (allowed === null) return "FAILED";
  return allowed ? null : "RATE_LIMITED";
}

export async function submitBookingAction(
  slug: string,
  _: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const tenant = await loadPublicTenant(slug);
  if (tenant.unavailable) return fail("UNAVAILABLE");
  const c = getContainer();
  const now = c.clock.now();
  const values = formValues(form);
  const website = form.get("website");
  const token = checkFormToken(c.formTokenKey, String(values.formToken), {
    tenantId: tenant.tenantId,
    vehicleId: String(values.vehicleId),
    now,
  });
  if (
    (typeof website === "string" && website !== "") ||
    (!token.ok && token.reason === "too_fast")
  ) {
    return DECOY;
  }
  if (!token.ok) return fail("EXPIRED");
  const limited = await submitLimit(tenant.tenantId);
  if (limited) return fail(limited);
  const parsed = publicBookingInput.safeParse(values);
  if (!parsed.success) {
    return fail("FORM_INVALID", { fields: parsed.error.issues.map((i) => String(i.path[0])) });
  }
  const result = await submit(parsed.data, {
    tenantId: tenant.tenantId,
    idempotencyKey: token.idempotencyKey,
    now,
  });
  return result ? outcome(result, tenant) : fail("FAILED");
}
