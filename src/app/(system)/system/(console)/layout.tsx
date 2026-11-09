import Link from "next/link";
import type { ReactNode } from "react";

import { requireSystemSession } from "@/app/_lib/session";
import { logoutSystemAction } from "@/app/actions/auth";
import { getTranslator } from "@/i18n";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  await requireSystemSession();
  const t = getTranslator();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <nav
          aria-label={t("auth.login.systemTitle")}
          className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
        >
          <Link href="/system" className="font-semibold underline-offset-4 hover:underline">
            {t("system.nav.tenants")}
          </Link>
          <Link href="/system/tenants/new" className="underline-offset-4 hover:underline">
            {t("system.nav.newTenant")}
          </Link>
          <form action={logoutSystemAction} className="ml-auto">
            <button type="submit" className="min-h-12 px-2 underline underline-offset-4">
              {t("auth.logout")}
            </button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
