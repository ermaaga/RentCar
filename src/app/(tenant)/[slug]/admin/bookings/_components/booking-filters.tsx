import Link from "next/link";

import { getTranslator } from "@/i18n";
import { ADMIN_BOOKING_SORTS, BOOKING_STATUSES, type AdminBookingQuery } from "@/modules/booking";
import { SelectField } from "@/ui/select-field";

// W-D3 filters: a plain GET form, so every filter lives in the URL (US-050) and works without
// JavaScript; Apply submits, "Clear filters" goes back to the bare list.

const INPUT = "min-h-12 rounded-md border border-border bg-background px-3 text-foreground";

function StatusChoices({ selected }: { selected: readonly string[] }) {
  const t = getTranslator();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-medium">{t("bookings.status")}</legend>
      <div className="flex flex-wrap gap-x-4">
        {BOOKING_STATUSES.map((s) => (
          <label key={s} className="flex min-h-12 items-center gap-2">
            <input
              type="checkbox"
              name="status"
              value={s}
              defaultChecked={selected.includes(s)}
              className="size-5"
            />
            {t(`bookings.state.${s}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function DateField(props: { name: "from" | "to"; value: string | null }) {
  const t = getTranslator();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`bookings-${props.name}`} className="font-medium">
        {t(`bookings.${props.name}`)}
      </label>
      <input
        id={`bookings-${props.name}`}
        type="date"
        name={props.name}
        defaultValue={props.value ?? ""}
        className={INPUT}
      />
    </div>
  );
}

function SearchField({ value }: { value: string }) {
  const t = getTranslator();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="bookings-q" className="font-medium">
        {t("bookings.searchLabel")}
      </label>
      <input
        id="bookings-q"
        name="q"
        type="search"
        maxLength={64}
        defaultValue={value}
        placeholder={t("bookings.search")}
        className={INPUT}
      />
    </div>
  );
}

function RangeAndOrder(props: {
  query: AdminBookingQuery;
  vehicles: readonly { id: string; name: string }[];
}) {
  const t = getTranslator();
  const { query } = props;
  const sorts = ADMIN_BOOKING_SORTS.flatMap((s) => [`${s}-desc`, `${s}-asc`] as const);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <DateField name="from" value={query.from} />
      <DateField name="to" value={query.to} />
      <SelectField
        id="bookings-vehicle"
        name="vehicle"
        label={t("bookings.vehicle")}
        defaultValue={query.vehicleId ?? ""}
        options={[
          { value: "", label: t("bookings.anyVehicle") },
          ...props.vehicles.map((v) => ({ value: v.id, label: v.name })),
        ]}
      />
      <SelectField
        id="bookings-sort"
        name="sort"
        label={t("bookings.sort")}
        defaultValue={`${query.sort}-${query.dir}`}
        options={sorts.map((value) => ({ value, label: t(`bookings.sortOption.${value}`) }))}
      />
    </div>
  );
}

export function BookingFilters(props: {
  slug: string;
  query: AdminBookingQuery;
  vehicles: readonly { id: string; name: string }[];
}) {
  const t = getTranslator();
  const base = `/${props.slug}/admin/bookings`;
  return (
    <form action={base} method="get" role="search" className="flex flex-col gap-4">
      <SearchField value={props.query.q} />
      <StatusChoices selected={props.query.statuses} />
      <RangeAndOrder query={props.query} vehicles={props.vehicles} />
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          className="min-h-12 rounded-md bg-primary px-4 font-semibold text-primary-foreground"
        >
          {t("bookings.apply")}
        </button>
        <Link href={base} className="min-h-12 content-center underline">
          {t("bookings.clear")}
        </Link>
      </div>
    </form>
  );
}
