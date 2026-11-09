import Link from "next/link";

import { requireTenantAdmin, tenantWriteRefusal } from "@/app/_lib/session";
import {
  createOperatorAction,
  reissueOperatorLinkAction,
  setOperatorActiveAction,
} from "@/app/actions/operators";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import { listOperators, operatorUsage, type OperatorRow } from "@/modules/auth";
import { AddOperatorForm } from "@/modules/auth/ui/add-operator-form";
import { getSmtpSummary } from "@/modules/notifications";
import { ConsoleActionForm } from "@/modules/tenancy/ui/console-action-form";
import { Alert } from "@/ui/alert";

export const dynamic = "force-dynamic";

function OperatorActions(props: { slug: string; op: OperatorRow; readOnly: boolean }) {
  const { slug, op } = props;
  if (props.readOnly) {
    return null;
  }
  const canResend = op.status === "pending" || op.status === "activation_not_delivered";
  const active = op.status !== "deactivated";
  return (
    <div className="flex flex-col gap-3">
      {canResend ? (
        <ConsoleActionForm
          action={reissueOperatorLinkAction.bind(null, slug, op.id)}
          submit="operators.resend"
        />
      ) : null}
      <ConsoleActionForm
        action={setOperatorActiveAction.bind(null, slug, op.id, !active)}
        submit={active ? "operators.deactivate" : "operators.reactivate"}
        submitParams={{ name: op.displayName }}
        {...(active ? { hint: "operators.deactivateHint" as const } : {})}
      />
    </div>
  );
}

function OperatorList(props: { slug: string; operators: OperatorRow[]; readOnly: boolean }) {
  const t = getTranslator();
  if (props.operators.length === 0) {
    return <p className="text-muted-foreground">{t("operators.empty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {props.operators.map((op) => (
        <li key={op.id} className="flex flex-col gap-2 rounded-md border border-border p-4">
          <p className="font-semibold">{op.displayName}</p>
          <p>{op.username}</p>
          <p className="break-all">{op.email}</p>
          <p>{t(`operators.status.${op.status}`)}</p>
          <OperatorActions slug={props.slug} op={op} readOnly={props.readOnly} />
        </li>
      ))}
    </ul>
  );
}

function SmtpWarning({ slug }: { slug: string }) {
  const t = getTranslator();
  return (
    <div className="mb-6 flex flex-col gap-2">
      <Alert kind="error">{t("operators.smtpMissing")}</Alert>
      <Link href={`/${slug}/admin/settings/email`} className="underline underline-offset-4">
        {t("operators.fixSmtp")}
      </Link>
    </div>
  );
}

export default async function OperatorsPage(props: { params: Promise<{ slug: string }> }) {
  const t = getTranslator();
  const { slug } = await props.params;
  const { tenant } = await requireTenantAdmin(slug);
  const c = getContainer();
  const now = c.clock.now();
  // Sequential on purpose: one request holds at most one pooled connection (pool max 5).
  const operators = await listOperators(c.pool, tenant.tenantId, now);
  const usage = await operatorUsage(c.pool, tenant.tenantId, now);
  const smtp = await getSmtpSummary(c.pool, tenant.tenantId);
  const refusal = await tenantWriteRefusal(tenant);
  const full = usage.used >= usage.max;
  const disabledReason = refusal ? t(refusal) : full ? t("operators.add.limitReached") : undefined;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href={`/${tenant.slug}/admin`} className="underline underline-offset-4">
        {t("admin.home.title")}
      </Link>
      <h1 className="mt-4 mb-2 text-2xl font-semibold">{t("operators.title")}</h1>
      <p className="mb-2">
        {formatMessage(t("operators.usage"), { used: usage.used, max: usage.max })}
      </p>
      <p className="mb-6 text-muted-foreground">{t("operators.intro")}</p>
      {smtp ? null : <SmtpWarning slug={tenant.slug} />}
      <section aria-labelledby="add-operator" className="mb-8 flex flex-col gap-3">
        <h2 id="add-operator" className="text-xl font-semibold">
          {t("operators.add.title")}
        </h2>
        <AddOperatorForm
          action={createOperatorAction.bind(null, tenant.slug)}
          {...(disabledReason ? { disabledReason } : {})}
        />
      </section>
      <OperatorList slug={tenant.slug} operators={operators} readOnly={refusal !== null} />
    </main>
  );
}
