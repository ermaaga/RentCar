import { getTranslator, type MessageKey } from "@/i18n";

// W-D5 step 1: pickup and return as separate native date and time inputs, sent by GET so the dates
// stay in the URL (the page reads them with parseSearchQuery, like the public search).

const INPUT = "min-h-12 rounded-md border border-border bg-background px-3 text-foreground";

function Input(props: {
  name: string;
  type: "date" | "time";
  label: MessageKey;
  value: string | undefined;
}) {
  const t = getTranslator();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`new-${props.name}`} className="font-medium">
        {t(props.label)}
      </label>
      <input
        id={`new-${props.name}`}
        name={props.name}
        type={props.type}
        required
        step={props.type === "time" ? 900 : undefined}
        defaultValue={props.value}
        className={INPUT}
      />
    </div>
  );
}

export function DatesForm(props: {
  slug: string;
  period: { pickup: string; return: string } | null;
}) {
  const t = getTranslator();
  const [pickupDate, pickupTime] = props.period?.pickup.split("T") ?? [];
  const [returnDate, returnTime] = props.period?.return.split("T") ?? [];
  return (
    <form method="get" action={`/${props.slug}/admin/bookings/new`} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("bookings.new.dates")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="pickupDate" type="date" label="bookings.new.pickupDate" value={pickupDate} />
        <Input
          name="pickupTime"
          type="time"
          label="bookings.new.pickupTime"
          value={pickupTime ?? "10:00"}
        />
        <Input name="returnDate" type="date" label="bookings.new.returnDate" value={returnDate} />
        <Input
          name="returnTime"
          type="time"
          label="bookings.new.returnTime"
          value={returnTime ?? "10:00"}
        />
      </div>
      <button
        type="submit"
        className="min-h-12 w-fit rounded-md border border-border px-4 font-semibold"
      >
        {t("bookings.new.showVehicles")}
      </button>
    </form>
  );
}
