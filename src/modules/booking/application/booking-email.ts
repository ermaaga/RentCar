import { formatMessage, type MessageKey } from "../../../i18n";
import { escapeHtml } from "../../notifications";

// Booking emails (docs/06-backend-api.md 9.2 `booking.confirmation`, `booking.admin_new_booking`).
// Rendered at send time from the booking row (no body is stored). The customer email carries the
// "ignore if you did not book" line and the tenant contact (SR-EML-04); the admin email adds the
// customer name and phone. Values are HTML-escaped; the translator is passed in.

type Translate = (key: MessageKey) => string;

export interface BookingEmailData {
  code: string;
  tenantTitle: string;
  contactEmail: string;
  contactPhone: string;
  firstName: string;
  lastName: string;
  phone: string;
  vehicleName: string;
  pickup: string;
  return: string;
  total: string;
  link: string;
}

function lines(t: Translate, d: BookingEmailData): [string, string][] {
  return [
    [t("email.booking.code"), d.code],
    [t("email.booking.vehicle"), d.vehicleName],
    [t("email.booking.pickup"), d.pickup],
    [t("email.booking.return"), d.return],
    [t("email.booking.total"), d.total],
  ];
}

function message(to: string, subject: string, paragraphs: string[], facts: [string, string][]) {
  const text = [
    ...paragraphs.slice(0, 1),
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    "",
    ...paragraphs.slice(1),
  ];
  const html = [
    `<p>${escapeHtml(paragraphs[0] ?? "")}</p>`,
    `<ul>${facts.map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(v)}</li>`).join("")}</ul>`,
    ...paragraphs.slice(1).map((p) => `<p>${escapeHtml(p)}</p>`),
  ];
  return { to, subject, text: text.join("\n"), html: html.join("\n") };
}

export function renderBookingConfirmation(to: string, d: BookingEmailData, t: Translate) {
  const vars = { code: d.code, tenant: d.tenantTitle, name: d.firstName };
  return message(
    to,
    formatMessage(t("email.booking.confirmation.subject"), vars),
    [
      formatMessage(t("email.booking.confirmation.intro"), vars),
      t("email.booking.confirmation.payment"),
      `${t("email.booking.confirmation.view")} ${d.link}`,
      formatMessage(t("email.booking.contact"), { email: d.contactEmail, phone: d.contactPhone }),
      formatMessage(t("email.booking.confirmation.notYou"), vars),
    ],
    lines(t, d),
  );
}

export function renderAdminNewBooking(to: string, d: BookingEmailData, t: Translate) {
  const customer = `${d.firstName} ${d.lastName}, ${d.phone}`;
  return message(
    to,
    formatMessage(t("email.booking.adminNew.subject"), { code: d.code }),
    [t("email.booking.adminNew.intro")],
    [...lines(t, d), [t("email.booking.adminNew.customer"), customer]],
  );
}
