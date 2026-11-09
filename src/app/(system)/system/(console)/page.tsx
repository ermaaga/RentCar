import Link from "next/link";

import { getContainer } from "@/composition/container";
import { getTranslator, type MessageKey } from "@/i18n";
import { listTenants, type TenantListRow } from "@/modules/tenancy";

const STATUS_KEY: Record<string, MessageKey> = {
  active: "system.status.active",
  suspended: "system.status.suspended",
  terminated: "system.status.terminated",
  pending: "system.status.pending",
};

const COLUMNS: readonly MessageKey[] = [
  "system.tenants.name",
  "system.tenants.slug",
  "system.tenants.status",
  "system.tenants.admin",
  "system.tenants.endDate",
];

function TenantTable({ rows }: { rows: readonly TenantListRow[] }) {
  const t = getTranslator();
  const label = (status: string | null) => t(STATUS_KEY[status ?? ""] ?? "system.tenants.none");
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            {COLUMNS.map((key) => (
              <th key={key} scope="col" className="py-2 pr-4">
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slug} className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href={`/system/tenants/${row.slug}`} className="underline underline-offset-4">
                  {row.name}
                </Link>
              </td>
              <td className="py-2 pr-4">{row.slug}</td>
              <td className="py-2 pr-4">{label(row.status)}</td>
              <td className="py-2 pr-4">{label(row.adminStatus)}</td>
              <td className="py-2 pr-4">{row.endDate ?? t("system.tenants.none")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TenantsPage() {
  const t = getTranslator();
  const tenants = await listTenants(getContainer().pool);
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">{t("system.tenants.title")}</h1>
      {tenants.length === 0 ? <p>{t("system.tenants.empty")}</p> : <TenantTable rows={tenants} />}
    </>
  );
}
