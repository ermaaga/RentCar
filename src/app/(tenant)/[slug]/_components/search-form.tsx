import type { PublicTenant } from "@/app/_lib/public-tenant";
import { formatMessage, getTranslator } from "@/i18n";
import { Alert } from "@/ui/alert";

import { leadLabel } from "./format";

// W-P1 search card (docs/04a-ux.md): a plain GET form to the results page, so it works without
// JavaScript; date and time are separate native controls, times in 15-minute steps.

const QUARTERS = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, "0");
  const m = String((i % 4) * 15).padStart(2, "0");
  return `${h}:${m}`;
});

const inputClass = "min-h-12 rounded-md border border-border bg-background px-3 text-foreground";

function When(props: { name: "pickup" | "return"; value: string; minDate: string }) {
  const t = getTranslator();
  const [date = "", time = "10:00"] = props.value.split("T");
  const times = QUARTERS.includes(time) ? QUARTERS : [...QUARTERS, time].sort();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold">{t(`public.search.${props.name}`)}</legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${props.name}Date`}>{t("public.search.date")}</label>
          <input
            id={`${props.name}Date`}
            name={`${props.name}Date`}
            type="date"
            required
            min={props.minDate}
            defaultValue={date}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${props.name}Time`}>{t("public.search.time")}</label>
          <select
            id={`${props.name}Time`}
            name={`${props.name}Time`}
            defaultValue={time}
            className={inputClass}
          >
            {times.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
    </fieldset>
  );
}

export function SearchForm(props: {
  tenant: PublicTenant;
  period: { pickup: string; return: string };
  minDate: string;
  error?: string | undefined;
}) {
  const t = getTranslator();
  const { rules } = props.tenant;
  const helper = [
    formatMessage(t("public.search.days"), { min: rules.minRentalDays, max: rules.maxRentalDays }),
    rules.leadTimeMinutes > 0
      ? formatMessage(t("public.search.lead"), { lead: leadLabel(rules.leadTimeMinutes) })
      : "",
    formatMessage(t("public.search.zone"), { zone: props.tenant.timeZone }),
  ].filter((s) => s !== "");
  return (
    <form
      role="search"
      action={`/${props.tenant.slug}/vehicles`}
      method="get"
      className="flex flex-col gap-4 rounded-md border border-border p-4"
      aria-describedby="search-helper"
    >
      {props.error ? <Alert kind="error">{props.error}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <When name="pickup" value={props.period.pickup} minDate={props.minDate} />
        <When name="return" value={props.period.return} minDate={props.minDate} />
      </div>
      <p id="search-helper" className="text-sm">
        {helper.join(" ")}
      </p>
      <button
        type="submit"
        className="min-h-12 rounded-md bg-primary px-4 font-semibold text-primary-foreground"
      >
        {t("public.search.submit")}
      </button>
    </form>
  );
}
