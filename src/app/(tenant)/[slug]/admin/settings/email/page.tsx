import Link from "next/link";

import { requireTenantAdmin } from "@/app/_lib/session";
import { saveSmtpSettingsAction, testSmtpAction } from "@/app/actions/smtp";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import { getSmtpSummary, SMTP_PORTS, type SmtpSummary } from "@/modules/notifications";
import { SmtpSettingsForm, SmtpTestForm } from "@/modules/notifications/ui/smtp-settings-form";

export const dynamic = "force-dynamic";

function lastTestText(summary: SmtpSummary, t: ReturnType<typeof getTranslator>): string {
  if (!summary.lastTestAt) return t("smtpSettings.neverTested");
  const when = summary.lastTestAt.toISOString().slice(0, 16).replace("T", " ");
  const outcome = summary.lastTestOk
    ? t("smtpSettings.lastTestOk")
    : formatMessage(t("smtpSettings.lastTestFailed"), { category: summary.lastTestError ?? "" });
  return `${when} UTC · ${outcome}`;
}

export default async function EmailSettingsPage(props: { params: Promise<{ slug: string }> }) {
  const t = getTranslator();
  const { slug } = await props.params;
  const { tenant } = await requireTenantAdmin(slug);
  const summary = await getSmtpSummary(getContainer().pool, tenant.tenantId);
  const values = summary
    ? { ...summary, fromName: summary.fromName ?? "", updatedAt: summary.updatedAt.toISOString() }
    : null;
  const lastTest = summary ? `${t("smtpSettings.lastTest")}: ${lastTestText(summary, t)}` : "";
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href={`/${tenant.slug}/admin`} className="underline underline-offset-4">
        {t("admin.home.title")}
      </Link>
      <h1 className="mt-4 mb-2 text-2xl font-semibold">{t("smtpSettings.title")}</h1>
      <p className="mb-4 max-w-xl">{t("smtpSettings.intro")}</p>
      {summary ? null : (
        <p className="mb-4 max-w-xl font-medium">{t("smtpSettings.notConfigured")}</p>
      )}
      <SmtpSettingsForm
        action={saveSmtpSettingsAction.bind(null, tenant.slug)}
        values={values}
        ports={SMTP_PORTS}
      />
      {summary ? (
        <section className="mt-8">
          <h2 className="mb-2 text-xl font-semibold">{t("smtpSettings.testTitle")}</h2>
          <p className="mb-3">{lastTest}</p>
          <SmtpTestForm action={testSmtpAction.bind(null, tenant.slug)} />
        </section>
      ) : null}
    </main>
  );
}
