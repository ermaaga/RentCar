"use server";

import { redirect } from "next/navigation";

import { dispatchAfterResponse } from "@/app/_lib/outbox";
import { loadPublicTenant, type PublicTenant } from "@/app/_lib/public-tenant";
import { consume, requestIp } from "@/app/_lib/security";
import { getContainer } from "@/composition/container";
import { checkFormToken, publicBookingInput, submitPublicBooking } from "@/modules/booking";
import type { SubmitResult } from "@/modules/booking";
import type { BookingErrorCode, BookingFormState } from "@/modules/booking/ui/booking-form-state";
import { RATE_LIMITS } from "@/platform/rate-limit/postgres";

// BKG-03 entry point (docs/06-backend-api.md): public by design (no account), the tenant comes from
// the slug only. Order: tenant can take bookings, honeypot and form token (bots get the silent decoy),
// RL-02 per tenant and IP, strict schema, then one tenant transaction. Success redirects to BKG-04.

const DECOY: BookingFormState = { status: "received" };
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
  const ip = await requestIp();
  if (!(await consume(RATE_LIMITS.publicBookingSubmit, `${tenant.tenantId}:${ip}`, "public"))) {
    return fail("RATE_LIMITED");
  }
  const parsed = publicBookingInput.safeParse(values);
  if (!parsed.success) {
    return fail("FORM_INVALID", { fields: parsed.error.issues.map((i) => String(i.path[0])) });
  }
  const result = await submitPublicBooking(c.pool, parsed.data, {
    tenantId: tenant.tenantId,
    idempotencyKey: token.idempotencyKey,
    now,
  }).catch(() => null);
  return result ? outcome(result, tenant) : fail("FAILED");
}
