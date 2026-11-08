import { getTranslator } from "@/i18n";

export default function HomePage() {
  const t = getTranslator();
  return (
    <main className="mx-auto max-w-prose px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("home.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("home.status")}</p>
    </main>
  );
}
