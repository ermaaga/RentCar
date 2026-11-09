import Link from "next/link";

import { requireTenantSession } from "@/app/_lib/session";
import { logoutTenantAction } from "@/app/actions/auth";
import { getTranslator } from "@/i18n";

export const dynamic = "force-dynamic";

export default async function AdminHomePage(props: { params: Promise<{ slug: string }> }) {
  const t = getTranslator();
  const { slug } = await props.params;
  const { tenant } = await requireTenantSession(slug);
  const heading = `${t("admin.home.title")} · ${tenant.name}`;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-2">{t("admin.home.signedIn")}</p>
      <Link
        href={`/${tenant.slug}/admin/account`}
        className="mt-4 inline-block underline underline-offset-4"
      >
        {t("auth.account.link")}
      </Link>
      <form action={logoutTenantAction.bind(null, tenant.slug)} className="mt-6">
        <button type="submit" className="min-h-12 underline underline-offset-4">
          {t("auth.logout")}
        </button>
      </form>
    </main>
  );
}
