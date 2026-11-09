import { loginSystemAction } from "@/app/actions/auth";
import { getTranslator } from "@/i18n";
import { LoginForm } from "@/modules/auth/ui/login-form";
import { AuthCard } from "@/ui/auth-card";

export const dynamic = "force-dynamic";

export default async function SystemLoginPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = getTranslator();
  const params = await props.searchParams;
  return (
    <AuthCard title={t("auth.login.systemTitle")}>
      <LoginForm action={loginSystemAction} notice={params.passwordSet === "1"} />
    </AuthCard>
  );
}
