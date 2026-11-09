import { requireTenant } from "@/app/_lib/session";
import { loginTenantAction } from "@/app/actions/auth";
import { getTranslator } from "@/i18n";
import { LoginForm } from "@/modules/auth/ui/login-form";
import { AuthCard } from "@/ui/auth-card";

export const dynamic = "force-dynamic";

export default async function TenantLoginPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = getTranslator();
  const { slug } = await props.params;
  const tenant = await requireTenant(slug);
  const query = await props.searchParams;
  return (
    <AuthCard title={`${t("auth.login.title")} · ${tenant.name}`}>
      <LoginForm
        forgotHref={`/${tenant.slug}/admin/forgot-password`}
        action={loginTenantAction.bind(null, tenant.slug)}
        notice={query.passwordSet === "1"}
      />
    </AuthCard>
  );
}
