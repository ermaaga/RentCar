import { formatMessage, type MessageKey } from "../../../i18n";

// buildConfirmationModel (docs/06-backend-api.md 10.1 step 2): pure. Every string is preformatted
// with the translator and Intl in the tenant currency and time zone, so the renderer only lays out
// text. No phone or email of the customer, no VAT line; metadata is the title and tenant name only.

type Translate = (key: MessageKey) => string;

export interface ConfirmationData {
  code: string;
  tenantTitle: string;
  contactEmail: string;
  contactPhone: string;
  vehicleName: string;
  firstName: string;
  lastName: string;
  startAt: Date;
  endAt: Date;
  timeZone: string;
  currency: string;
  dailyPriceMinor: number;
  billedDays: number;
  totalMinor: number;
}

export interface ConfirmationModel {
  title: string;
  tenantName: string;
  tenantContact: string;
  codeLabel: string;
  code: string;
  rows: readonly (readonly [string, string])[];
  notes: readonly string[];
}

/** "03 Jun 2026, 10:00" in the tenant zone. */
function dateTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/** "AB12CD34EF" -> "AB12 CD34 EF" (easier to read out at the counter). */
export function groupCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1 ");
}

export function buildConfirmationModel(d: ConfirmationData, t: Translate): ConfirmationModel {
  const money = new Intl.NumberFormat("en", { style: "currency", currency: d.currency });
  const amount = (minor: number) => money.format(minor / 100);
  return {
    title: t("public.pdf.title"),
    tenantName: d.tenantTitle,
    tenantContact: formatMessage(t("public.pdf.contact"), {
      email: d.contactEmail,
      phone: d.contactPhone,
    }),
    codeLabel: t("public.pdf.code"),
    code: groupCode(d.code),
    rows: [
      [t("public.pdf.customer"), `${d.firstName} ${d.lastName}`],
      [t("public.pdf.vehicle"), d.vehicleName],
      [t("public.pdf.pickup"), dateTime(d.startAt, d.timeZone)],
      [t("public.pdf.return"), dateTime(d.endAt, d.timeZone)],
      [t("public.pdf.dailyPrice"), amount(d.dailyPriceMinor)],
      [t("public.pdf.days"), String(d.billedDays)],
      [t("public.pdf.total"), amount(d.totalMinor)],
    ],
    notes: [
      formatMessage(t("public.pdf.timeNotice"), { zone: d.timeZone }),
      t("public.pdf.payment"),
      t("public.pdf.disclaimer"),
    ],
  };
}
