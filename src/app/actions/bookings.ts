"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { tenantAction } from "@/app/_lib/define-action";
import { getContainer } from "@/composition/container";
import type { MessageKey } from "@/i18n";
import { changeBookingStatus, setPayment, type ChangeError } from "@/modules/booking";
import type { ConsoleActionState } from "@/modules/tenancy/ui/console-action-form";
import { singleLineText } from "@/shared/text";

// BKG-09 changeBookingStatus and BKG-10 setPayment from the booking detail page (W-D4): tenant admin
// only, allowed while the tenant is read-only (BE-1 A). The page binds the code and the version it
// showed; both are checked here, because bound arguments come from the client.

const ADMIN_RO_ALLOWED = {
  minRole: "admin",
  writeClass: "ro_allowed",
  onRefused: (messageKey: MessageKey): ConsoleActionState => ({ status: "error", messageKey }),
} as const;

export interface BookingRef {
  code: string;
  version: number;
}

const ERRORS: Record<ChangeError, MessageKey> = {
  NOT_FOUND: "bookings.detail.notFound",
  BOOKING_STALE: "bookings.actions.error.stale",
  BOOKING_INVALID_TRANSITION: "bookings.actions.error.invalidTransition",
  BOOKING_COMPLETE_BEFORE_START: "bookings.actions.error.completeBeforeStart",
  BOOKING_NOT_EDITABLE: "bookings.actions.error.notEditable",
  PAYMENT_CONFIRMATION_REQUIRED: "bookings.actions.error.confirmRequired",
};

const error = (messageKey: MessageKey): ConsoleActionState => ({ status: "error", messageKey });
const reasonText = singleLineText(0, 500);

function parseRef(value: unknown): BookingRef | null {
  if (typeof value !== "object" || value === null) return null;
  const { code, version } = value as Partial<Record<keyof BookingRef, unknown>>;
  if (typeof code !== "string" || code.length > 20) return null;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  return { code, version };
}

function ctxOf(
  tenant: { tenantId: string; timeZone: string },
  session: { userId: string; role: string },
) {
  return {
    tenantId: tenant.tenantId,
    timeZone: tenant.timeZone,
    now: getContainer().clock.now(),
    actor: { userId: session.userId, role: session.role },
  };
}

/** The outcomes the detail page can announce after a redirect (`?done=`), announced by the page. */
type BookingDone = "paid" | "unpaid" | "active" | "complete" | "cancel" | "cancelPaid";

/**
 * Success leaves the form: the panel that sent it may no longer exist (a paid booking has no
 * "Record payment", a cancelled one has no actions), so the page announces the outcome instead.
 */
function done(slug: string, code: string, outcome: BookingDone): never {
  revalidatePath(`/${slug}/admin/bookings`);
  redirect(`/${slug}/admin/bookings/${code}?done=${outcome}`);
}

/** BKG-10 paid=true: the method comes from the form, the amount is always the current total. */
export const recordPaymentAction = tenantAction(
  ADMIN_RO_ALLOWED,
  async ({ tenant, session }, bound: BookingRef, _: ConsoleActionState, form: FormData) => {
    const ref = parseRef(bound);
    const method = form.get("method");
    if (!ref) return error("bookings.actions.error.stale");
    if (method !== "card" && method !== "cash") return error("bookings.actions.error.method");
    const result = await setPayment(
      getContainer().pool,
      { code: ref.code, expectedVersion: ref.version, change: { paid: true, method } },
      ctxOf(tenant, session),
    );
    if (!result.ok) return error(ERRORS[result.code]);
    return done(tenant.slug, ref.code, "paid");
  },
);

/** BKG-10 paid=false: only from the confirmation panel, which sends confirm=yes. */
export const clearPaymentAction = tenantAction(
  ADMIN_RO_ALLOWED,
  async ({ tenant, session }, bound: BookingRef, _: ConsoleActionState, form: FormData) => {
    const ref = parseRef(bound);
    if (!ref) return error("bookings.actions.error.stale");
    const change = { paid: false as const, confirm: form.get("confirm") === "yes" };
    const result = await setPayment(
      getContainer().pool,
      { code: ref.code, expectedVersion: ref.version, change },
      ctxOf(tenant, session),
    );
    if (!result.ok) return error(ERRORS[result.code]);
    return done(tenant.slug, ref.code, "unpaid");
  },
);

const TARGETS = ["active", "complete", "cancel"] as const;
export interface StatusRef extends BookingRef {
  target: (typeof TARGETS)[number];
}

/** BKG-09: mark active, complete or cancel (with an optional single-line reason). */
export const changeBookingStatusAction = tenantAction(
  ADMIN_RO_ALLOWED,
  async ({ tenant, session }, bound: StatusRef, _: ConsoleActionState, form: FormData) => {
    const ref = parseRef(bound);
    const target = TARGETS.find((x) => x === (bound as Partial<StatusRef> | null)?.target);
    const reason = reasonText.safeParse(form.get("reason") ?? "");
    if (!ref || !target) return error("bookings.actions.error.stale");
    if (!reason.success) return error("bookings.actions.error.reason");
    const result = await changeBookingStatus(
      getContainer().pool,
      { code: ref.code, expectedVersion: ref.version, target, reason: reason.data || null },
      ctxOf(tenant, session),
    );
    if (!result.ok) return error(ERRORS[result.code]);
    return done(tenant.slug, ref.code, result.refundOutsideSystem ? "cancelPaid" : target);
  },
);
