import { createTenantAction } from "@/app/actions/tenancy";
import { getTranslator } from "@/i18n";
import { CreateTenantForm } from "@/modules/tenancy/ui/create-tenant-form";

export default function NewTenantPage() {
  const t = getTranslator();
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">{t("system.newTenant.title")}</h1>
      <CreateTenantForm action={createTenantAction} />
    </>
  );
}
