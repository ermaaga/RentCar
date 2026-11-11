import { getTranslator } from "../../../i18n";

/** The vehicle's 480 px cover (decorative: the card heading names the vehicle) or a placeholder. */
export function OfferCover({ url }: { url: string | null }) {
  const t = getTranslator();
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={480}
        height={360}
        loading="lazy"
        className="aspect-[4/3] w-full rounded-md object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-border text-sm"
    >
      {t("public.results.noPhoto")}
    </div>
  );
}
