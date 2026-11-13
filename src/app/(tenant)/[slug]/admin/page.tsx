import Link from "next/link";

import { requireTenantSession } from "@/app/_lib/session";
import { logoutTenantAction } from "@/app/actions/auth";
import { getTranslator, type MessageKey } from "@/i18n";

export const dynamic = "force-dynamic";

const LINKS: readonly { path: string; label: MessageKey; adminOnly: boolean }[] = [
  { path: "bookings", label: "bookings.link", adminOnly: false },
  { path: "vehicles", label: "vehicles.link", adminOnly: false },
  { path: "account", label: "auth.account.link", adminOnly: false },
  { path: "operators", label: "operators.link", adminOnly: true },
  { path: "settings/email", label: "settings.email.link", adminOnly: true },
];

export default async function AdminHomePage(props: { params: Promise<{ slug: string }> }) {
  const t = getTranslator();
  const { slug } = await props.params;
  const { tenant, session } = await requireTenantSession(slug);
  const heading = `${t("admin.home.title")} · ${tenant.name}`;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-2">{t("admin.home.signedIn")}</p>
      <nav className="mt-4 flex flex-wrap gap-6">
        {LINKS.filter((l) => !l.adminOnly || session.role === "admin").map((l) => (
          <Link
            key={l.path}
            href={`/${tenant.slug}/admin/${l.path}`}
            className="underline underline-offset-4"
          >
            {t(l.label)}
          </Link>
        ))}
      </nav>
      <form action={logoutTenantAction.bind(null, tenant.slug)} className="mt-6">
        <button type="submit" className="min-h-12 underline underline-offset-4">
          {t("auth.logout")}
        </button>
      </form>
    </main>
  );
}
