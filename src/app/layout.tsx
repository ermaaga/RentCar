import type { ReactNode } from "react";

import "@/styles/globals.css";
import { getTranslator } from "@/i18n";

export function generateMetadata() {
  const t = getTranslator();
  return { title: t("app.name"), description: t("app.description") };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground min-h-dvh font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
