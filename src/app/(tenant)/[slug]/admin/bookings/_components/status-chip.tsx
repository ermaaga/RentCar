import { getTranslator } from "@/i18n";
import type { BookingStatus } from "@/modules/booking";

// Status and payment chips (W-D3/W-D4): a word always, colour never alone (FR-BRD-04 rule).

export function StatusChip({ status }: { status: BookingStatus }) {
  const t = getTranslator();
  return (
    <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-sm font-medium">
      {t(`bookings.state.${status}`)}
    </span>
  );
}

export function PaymentChip({ paid }: { paid: boolean }) {
  const t = getTranslator();
  return (
    <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-sm">
      {t(paid ? "bookings.paid" : "bookings.unpaid")}
    </span>
  );
}
