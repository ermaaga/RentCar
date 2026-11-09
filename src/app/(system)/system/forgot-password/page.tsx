import Link from "next/link";

import { requestSystemResetAction } from "@/app/actions/password-reset";
import { getTranslator } from "@/i18n";
import { ForgotPasswordForm } from "@/modules/auth/ui/forgot-password-form";
import { AuthCard } from "@/ui/auth-card";

export default function SystemForgotPasswordPage() {
  const t = getTranslator();
  return (
    <AuthCard title={t("auth.forgot.title")}>
      <ForgotPasswordForm action={requestSystemResetAction} />
      <Link href="/system/login" className="mt-6 inline-block underline underline-offset-4">
        {t("auth.forgot.back")}
      </Link>
    </AuthCard>
  );
}
