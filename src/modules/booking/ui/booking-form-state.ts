// State of the public booking form (BKG-03). Success redirects to the confirmation page, so it has no
// state; `received` is the silent decoy shown to bots (SR-RL-05).

export type BookingErrorCode =
  | "FORM_INVALID"
  | "PHONE_INVALID"
  | "VEHICLE_TAKEN"
  | "PRICE_CHANGED"
  | "PHONE_BOOKING_LIMIT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "EXPIRED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "FAILED";

export type BookingFormState =
  | { status: "idle" }
  | { status: "received" }
  | { status: "error"; code: BookingErrorCode; total?: string; fields?: readonly string[] };

export type BookingAction = (state: BookingFormState, form: FormData) => Promise<BookingFormState>;
