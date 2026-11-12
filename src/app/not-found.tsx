import type { Metadata } from "next";

import { getTranslator } from "@/i18n";

// Unknown slugs and paths answer 404 with noindex (docs/09-seo.md SR-05).
export function generateMetadata(): Metadata {
  return {
    title: getTranslator()("app.notFound.title"),
    robots: { index: false, follow: false },
  };
}

export default function NotFound() {
  const t = getTranslator();
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("app.notFound.title")}</h1>
      <p className="mt-2">{t("app.notFound.body")}</p>
    </main>
  );
}
