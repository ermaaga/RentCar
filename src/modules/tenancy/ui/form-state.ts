import type { MessageKey } from "../../../i18n";

export type CreateTenantState =
  | { status: "idle" }
  | { status: "error"; messageKey: MessageKey; fields: readonly string[] }
  | { status: "created"; slug: string; emailSent: boolean };

export const CREATE_TENANT_IDLE: CreateTenantState = { status: "idle" };
