import { changeSystemPasswordAction } from "@/app/actions/auth";
import { getTranslator } from "@/i18n";
import { ChangePasswordForm } from "@/modules/auth/ui/change-password-form";

export default function SystemAccountPage() {
  const t = getTranslator();
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">{t("auth.account.title")}</h1>
      <h2 className="mb-4 text-xl font-semibold">{t("auth.account.changeTitle")}</h2>
      <ChangePasswordForm action={changeSystemPasswordAction} />
    </>
  );
}
