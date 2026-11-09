import Link from "next/link";

import { requireTenant } from "@/app/_lib/session";
import { requestTenantResetAction } from "@/app/actions/password-reset";
import { getTranslator } from "@/i18n";
import { ForgotPasswordForm } from "@/modules/auth/ui/forgot-password-form";
import { AuthCard } from "@/ui/auth-card";

export const dynamic = "force-dynamic";

export default async function TenantForgotPasswordPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const t = getTranslator();
  const { slug } = await props.params;
  const tenant = await requireTenant(slug);
  return (
    <AuthCard title={t("auth.forgot.title")}>
      <ForgotPasswordForm action={requestTenantResetAction.bind(null, tenant.slug)} />
      <Link
        href={`/${tenant.slug}/admin/login`}
        className="mt-6 inline-block underline underline-offset-4"
      >
        {t("auth.forgot.back")}
      </Link>
    </AuthCard>
  );
}
