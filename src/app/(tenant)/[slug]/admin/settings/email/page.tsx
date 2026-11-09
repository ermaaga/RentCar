import Link from "next/link";

import { requireTenantAdmin } from "@/app/_lib/session";
import { saveSmtpAction, testSmtpAction } from "@/app/actions/settings";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator, type MessageKey } from "@/i18n";
import { getSmtpSummary } from "@/modules/notifications";
import { SmtpSettingsForm, SmtpTestForm } from "@/modules/notifications/ui/smtp-settings-form";

export const dynamic = "force-dynamic";

function lastTestText(
  t: (key: MessageKey) => string,
  summary: Awaited<ReturnType<typeof getSmtpSummary>>,
): string {
  if (!summary?.lastTestAt) {
    return t("settings.email.never");
  }
  const when = summary.lastTestAt.toISOString().slice(0, 16).replace("T", " ");
  const outcome = summary.lastTestOk
    ? t("settings.email.lastTestOk")
    : t("settings.email.lastTestFailed");
  return `${when} UTC · ${outcome}`;
}

export default async function EmailSettingsPage(props: { params: Promise<{ slug: string }> }) {
  const t = getTranslator();
  const { slug } = await props.params;
  const { tenant } = await requireTenantAdmin(slug);
  const summary = await getSmtpSummary(getContainer().pool, tenant.tenantId);
  const values = summary
    ? { ...summary, fromName: summary.fromName ?? "", passwordSet: summary.passwordSet }
    : null;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href={`/${tenant.slug}/admin`} className="underline underline-offset-4">
        {t("admin.home.title")}
      </Link>
      <h1 className="mt-4 mb-2 text-2xl font-semibold">{t("settings.email.title")}</h1>
      <p className="mb-6 max-w-xl text-muted-foreground">{t("settings.email.intro")}</p>
      <SmtpSettingsForm action={saveSmtpAction.bind(null, tenant.slug)} values={values} />
      <section className="mt-8 flex flex-col gap-2" aria-labelledby="smtp-test">
        <h2 id="smtp-test" className="text-xl font-semibold">
          {t("settings.email.test")}
        </h2>
        <p className="text-muted-foreground">
          {formatMessage(t("settings.email.lastTest"), { result: lastTestText(t, summary) })}
        </p>
        <SmtpTestForm action={testSmtpAction.bind(null, tenant.slug)} />
      </section>
    </main>
  );
}
