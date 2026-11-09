import Link from "next/link";
import type { ReactNode } from "react";

import type { PublicTenant } from "@/app/_lib/public-tenant";
import { formatMessage, getTranslator } from "@/i18n";

// Public header and footer (docs/04a-ux.md 4.1): title linking home, Contact always in the same place
// (WCAG 3.2.6), legal links in the footer. No cookies, no third-party requests (FR-PUB-13).

function LegalLink(props: { href: string | null; label: string }) {
  const t = getTranslator();
  if (!props.href) return null;
  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer" className="underline">
      {props.label} <span className="sr-only">{t("public.nav.newTab")}</span>
    </a>
  );
}

function ContactBlock({ tenant }: { tenant: PublicTenant }) {
  const t = getTranslator();
  const a = tenant.address;
  return (
    <section id="contact" aria-labelledby="contact-title" className="flex flex-col gap-1">
      <h2 id="contact-title" className="text-lg font-semibold">
        {t("public.contact.title")}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt>{t("public.contact.phone")}</dt>
        <dd>
          <a href={`tel:${tenant.contactPhone.replace(/[^\d+]/g, "")}`} className="underline">
            {tenant.contactPhone}
          </a>
        </dd>
        <dt>{t("public.contact.email")}</dt>
        <dd>
          <a href={`mailto:${tenant.contactEmail}`} className="underline">
            {tenant.contactEmail}
          </a>
        </dd>
        {a ? <dt>{t("public.contact.address")}</dt> : null}
        {a ? <dd>{formatMessage(t("public.contact.addressLine"), { ...a })}</dd> : null}
      </dl>
    </section>
  );
}

export function PublicShell(props: { tenant: PublicTenant; children: ReactNode }) {
  const t = getTranslator();
  const { tenant } = props;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href={`/${tenant.slug}`} className="text-lg font-semibold">
            {tenant.title}
          </Link>
          <a href="#contact" className="min-h-12 content-center underline underline-offset-4">
            {t("public.nav.contact")}
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{props.children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
          <ContactBlock tenant={tenant} />
          <nav aria-label={t("public.nav.footer")} className="flex flex-wrap gap-6">
            <LegalLink href={tenant.privacyUrl} label={t("public.nav.privacy")} />
            <LegalLink href={tenant.termsUrl} label={t("public.nav.terms")} />
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** W-P5: the tenant exists but cannot take bookings (suspended, terminated or no valid plan). */
export function UnavailableNotice({ tenant }: { tenant: PublicTenant }) {
  const t = getTranslator();
  const paused = tenant.unavailable === "paused";
  const title = paused
    ? formatMessage(t("public.unavailable.pausedTitle"), { tenant: tenant.title })
    : t("public.unavailable.closedTitle");
  const body = paused
    ? t("public.unavailable.pausedBody")
    : formatMessage(t("public.unavailable.closedBody"), { tenant: tenant.title });
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p>{body}</p>
    </div>
  );
}
