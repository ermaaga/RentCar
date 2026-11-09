import { en, type Messages } from "./messages/en";

export type Locale = "en";
export type MessageKey = {
  [K in keyof Messages]: Messages[K] extends string ? K : `${K}.${MessageKey_<Messages[K]>}`;
}[keyof Messages];
type MessageKey_<T> = T extends object
  ? {
      [K in keyof T]: T[K] extends string ? K & string : `${K & string}.${MessageKey_<T[K]>}`;
    }[keyof T]
  : never;

const catalogs: Record<Locale, Messages> = { en };

/** Returns the text for a key. Keys are checked at compile time, so a missing key does not build. */
export function getTranslator(locale: Locale = "en"): (key: MessageKey) => string {
  const catalog = catalogs[locale];
  return (key) => {
    const value = key.split(".").reduce<unknown>((node, part) => {
      if (node !== null && typeof node === "object" && part in node) {
        return (node as Record<string, unknown>)[part];
      }
      return undefined;
    }, catalog);
    if (typeof value !== "string") {
      throw new Error(`missing message key: ${key}`);
    }
    return value;
  };
}

/** Replaces `{name}` placeholders; unknown placeholders are left as they are. */
export function formatMessage(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
