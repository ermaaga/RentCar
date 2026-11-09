import Link from "next/link";

import { requireTenantSession } from "@/app/_lib/session";
import { changeTenantPasswordAction } from "@/app/actions/auth";
import { getTranslator } from "@/i18n";
import { ChangePasswordForm } from "@/modules/auth/ui/change-password-form";

export const dynamic = "force-dynamic";

export default async function TenantAccountPage(props: { params: Promise<{ slug: string }> }) {
  const t = getTranslator();
  const { slug } = await props.params;
  const { tenant } = await requireTenantSession(slug);
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href={`/${tenant.slug}/admin`} className="underline underline-offset-4">
        {t("admin.home.title")}
      </Link>
      <h1 className="mt-4 mb-2 text-2xl font-semibold">{t("auth.account.title")}</h1>
      <h2 className="mb-4 text-xl font-semibold">{t("auth.account.changeTitle")}</h2>
      <ChangePasswordForm action={changeTenantPasswordAction.bind(null, tenant.slug)} />
    </main>
  );
}
