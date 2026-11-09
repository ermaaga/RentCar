import { getTranslator } from "../../../i18n";
import { Field } from "../../../ui/field";

/** New password and its confirmation, shared by the set-password and change-password forms. */
export function NewPasswordFields() {
  const t = getTranslator();
  return (
    <>
      <Field
        name="password"
        type="password"
        label={t("auth.setPassword.password")}
        hint={t("auth.setPassword.hint")}
        autoComplete="new-password"
        required
      />
      <Field
        name="confirm"
        type="password"
        label={t("auth.setPassword.confirm")}
        autoComplete="new-password"
        required
      />
    </>
  );
}
