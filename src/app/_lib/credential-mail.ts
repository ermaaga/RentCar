import { getContainer } from "@/composition/container";
import { getTranslator } from "@/i18n";
import { credentialPath } from "@/modules/auth";
import { renderCredentialEmail } from "@/modules/notifications";
import type { MailMessage } from "@/platform/mailer/port";

// The tenant-staff activation email (docs/06-backend-api.md 9.2 `credential.activation`): the link is
// built from APP_BASE_URL and the tenant slug, never from request headers.
export function tenantActivationMail(
  slug: string,
  account: { email: string; displayName: string; username: string; token: string },
): MailMessage {
  return renderCredentialEmail(
    {
      purpose: "activation",
      to: account.email,
      displayName: account.displayName,
      username: account.username,
      link: `${getContainer().baseUrl}${credentialPath({ kind: "tenant", slug }, "activation", account.token)}`,
    },
    getTranslator(),
  );
}
