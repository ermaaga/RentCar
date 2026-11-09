import { getTranslator, type MessageKey } from "@/i18n";
import type { AuthAction } from "@/modules/auth/ui/form-state";
import { SetPasswordForm } from "@/modules/auth/ui/set-password-form";
import { Alert } from "@/ui/alert";
import { AuthCard } from "@/ui/auth-card";

import { peekLink } from "./session";

type Peek = Awaited<ReturnType<typeof peekLink>>;

const STATE_MESSAGE: Record<Peek["state"], MessageKey> = {
  valid: "auth.setPassword.invalid",
  used: "auth.setPassword.used",
  expired: "auth.setPassword.expired",
  invalid: "auth.setPassword.invalid",
};

const MAX_TOKEN = 128;

async function peekOrInvalid(realm: Parameters<typeof peekLink>[0], token: string): Promise<Peek> {
  if (token.length === 0 || token.length > MAX_TOKEN) {
    return { state: "invalid" };
  }
  return peekLink(realm, token);
}

/** Shared by the activation and reset pages of both realms: peek on render, redeem on submit. */
export async function SetPasswordPage(props: {
  realm: Parameters<typeof peekLink>[0];
  token: string | undefined;
  action: AuthAction;
}) {
  const t = getTranslator();
  const token = props.token ?? "";
  const peek = await peekOrInvalid(props.realm, token);
  const title = t(
    peek.purpose === "password_reset"
      ? "auth.setPassword.resetTitle"
      : "auth.setPassword.activateTitle",
  );
  return (
    <AuthCard title={title}>
      {peek.state === "valid" ? (
        <SetPasswordForm action={props.action} token={token} username={peek.username ?? ""} />
      ) : (
        <Alert kind="error">{t(STATE_MESSAGE[peek.state])}</Alert>
      )}
    </AuthCard>
  );
}
