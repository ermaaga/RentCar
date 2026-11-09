import { SetPasswordPage } from "@/app/_lib/set-password-page";
import { requireTenant } from "@/app/_lib/session";
import { redeemTenantAction } from "@/app/actions/auth";
import { tenantRealm } from "@/modules/auth";

export const dynamic = "force-dynamic";

export default async function TenantActivatePage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await props.params;
  const tenant = await requireTenant(slug);
  const { token } = await props.searchParams;
  return (
    <SetPasswordPage
      realm={tenantRealm(tenant.tenantId)}
      token={typeof token === "string" ? token : undefined}
      action={redeemTenantAction.bind(null, tenant.slug)}
    />
  );
}
