import Link from "next/link";
import { notFound } from "next/navigation";

import {
  adminAccessLinkAction,
  renewSubscriptionAction,
  setTenantStatusAction,
} from "@/app/actions/tenancy";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import { getTenantDetail, type TenantDetail } from "@/modules/tenancy";
import { ConsoleActionForm } from "@/modules/tenancy/ui/console-action-form";
import { Field } from "@/ui/field";

function StatusSection({ tenant }: { tenant: TenantDetail }) {
  const t = getTranslator();
  const suspended = tenant.status === "suspended";
  return (
    <section aria-labelledby="status-heading" className="flex flex-col gap-3">
      <h2 id="status-heading" className="text-xl font-semibold">
        {t("tenantDetail.status")}
      </h2>
      <p>{t(suspended ? "system.status.suspended" : "system.status.active")}</p>
      <ConsoleActionForm
        action={setTenantStatusAction.bind(null, tenant.slug, suspended ? "active" : "suspended")}
        submit={suspended ? "tenantDetail.reactivate" : "tenantDetail.suspend"}
        {...(suspended ? {} : { hint: "tenantDetail.suspendHint" as const })}
      />
    </section>
  );
}

function SubscriptionCard(props: { slug: string; sub: TenantDetail["subscriptions"][number] }) {
  const t = getTranslator();
  const s = props.sub;
  const period = `${t("tenantDetail.period")}: ${s.startDate} – ${s.endDate}`;
  const limits = `${t("tenantDetail.limits")}: ${formatMessage(t("tenantDetail.limitsValue"), {
    vehicles: s.maxVehicles,
    operators: s.maxOperators,
  })}`;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-4">
      <p>{period}</p>
      <p>{limits}</p>
      {s.status === "cancelled" ? null : (
        <ConsoleActionForm
          action={renewSubscriptionAction.bind(null, props.slug, s.id)}
          submit="tenantDetail.renew"
        >
          <Field
            name="endDate"
            type="date"
            label={t("tenantDetail.newEndDate")}
            defaultValue={s.endDate}
            required
          />
        </ConsoleActionForm>
      )}
    </div>
  );
}

function SubscriptionSection({ tenant }: { tenant: TenantDetail }) {
  const t = getTranslator();
  return (
    <section aria-labelledby="subs-heading" className="flex flex-col gap-4">
      <h2 id="subs-heading" className="text-xl font-semibold">
        {t("tenantDetail.subscriptions")}
      </h2>
      {tenant.subscriptions.map((s) => (
        <SubscriptionCard key={s.id} slug={tenant.slug} sub={s} />
      ))}
    </section>
  );
}

function AdminSection({ tenant }: { tenant: TenantDetail }) {
  const t = getTranslator();
  const admin = tenant.admin;
  const identity = admin ? `${admin.displayName} · ${admin.username} · ${admin.email}` : "";
  return (
    <section aria-labelledby="admin-heading" className="flex flex-col gap-3">
      <h2 id="admin-heading" className="text-xl font-semibold">
        {t("tenantDetail.adminTitle")}
      </h2>
      {admin ? (
        <>
          <p>{identity}</p>
          <p>{t(admin.status === "active" ? "system.status.active" : "system.status.pending")}</p>
          <ConsoleActionForm
            action={adminAccessLinkAction.bind(null, tenant.slug)}
            submit="tenantDetail.accessLink"
            hint="tenantDetail.accessLinkHint"
          />
        </>
      ) : (
        <p>{t("tenantDetail.adminNone")}</p>
      )}
    </section>
  );
}

export default async function TenantDetailPage(props: { params: Promise<{ slug: string }> }) {
  const t = getTranslator();
  const { slug } = await props.params;
  const tenant = await getTenantDetail(getContainer().pool, slug);
  if (!tenant) {
    notFound();
  }
  const contact = `${t("tenantDetail.contact")}: ${tenant.contactEmail ?? t("system.tenants.none")}`;
  return (
    <div className="flex flex-col gap-8">
      <Link href="/system" className="underline underline-offset-4">
        {t("tenantDetail.back")}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <p className="text-muted-foreground">{tenant.slug}</p>
        <p>{contact}</p>
      </div>
      <StatusSection tenant={tenant} />
      <SubscriptionSection tenant={tenant} />
      <AdminSection tenant={tenant} />
    </div>
  );
}
