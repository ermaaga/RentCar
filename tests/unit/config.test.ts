import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ConfigError, configSchema, loadConfig } from "../../src/platform/config";

const KEY = "k".repeat(40);
const localEnv = {
  APP_ENV: "local",
  APP_ENCRYPTION_KEY: KEY,
  CRON_SECRET: KEY,
  PASSWORD_PEPPER: KEY,
};

/** Variables read only by compose (database bootstrap), not by the application config. */
const COMPOSE_ONLY = [
  "POSTGRES_ADMIN_PASSWORD",
  "ROLE_MIGRATOR_PASSWORD",
  "ROLE_APP_PASSWORD",
  "ROLE_BACKUP_PASSWORD",
  "COMPOSE_PROFILES",
];

function envKeysInExample(): string[] {
  const text = readFileSync(resolve(__dirname, "../../.env.example"), "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.split("=")[0] ?? "")
    .filter((key) => !COMPOSE_ONLY.includes(key));
}

describe("loadConfig", () => {
  it("accepts a local configuration and applies defaults", () => {
    const cfg = loadConfig(localEnv);
    expect(cfg.APP_ENV).toBe("local");
    expect(cfg.HOST_KIND).toBe("server");
    expect(cfg.APP_BASE_URL).toBe("http://localhost:3000");
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it("rejects a secret shorter than 32 characters without printing its value", () => {
    const err = captureError(() => loadConfig({ ...localEnv, CRON_SECRET: "short-secret-value" }));
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("CRON_SECRET");
    expect(err.message).not.toContain("short-secret-value");
  });

  it("refuses placeholder secrets in production and accepts them locally", () => {
    const placeholder = `INSECURE_DEV_${"x".repeat(40)}`;
    expect(() => loadConfig({ ...localEnv, APP_ENCRYPTION_KEY: placeholder })).not.toThrow();
    const err = captureError(() =>
      loadConfig({
        ...localEnv,
        APP_ENV: "production",
        APP_BASE_URL: "https://example.test",
        APP_ENCRYPTION_KEY: placeholder,
      }),
    );
    expect(err.message).toContain("APP_ENCRYPTION_KEY");
    expect(err.message).not.toContain(placeholder);
  });

  it("requires an explicit trusted proxy count in production (SR-RL-02, SR-CFG-02)", () => {
    const prod = { ...localEnv, APP_ENV: "production", APP_BASE_URL: "https://example.test" };
    expect(captureError(() => loadConfig(prod)).message).toContain("TRUSTED_PROXY_COUNT");
    expect(loadConfig({ ...prod, TRUSTED_PROXY_COUNT: "1" }).TRUSTED_PROXY_COUNT).toBe(1);
  });

  it("requires https in staging", () => {
    const err = captureError(() =>
      loadConfig({ ...localEnv, APP_ENV: "staging", APP_BASE_URL: "http://staging.test" }),
    );
    expect(err.message).toContain("APP_BASE_URL");
  });
});

describe("loadConfig: system SMTP", () => {
  it("allows the Mailpit override only locally, and plaintext SMTP only with it", () => {
    const mailpit = { SYSTEM_SMTP_SECURITY: "none", SMTP_DEV_ALLOW_PRIVATE: "true" };
    expect(loadConfig({ ...localEnv, ...mailpit }).SMTP_DEV_ALLOW_PRIVATE).toBe(true);
    const ci = captureError(() => loadConfig({ ...localEnv, ...mailpit, APP_ENV: "ci" }));
    expect(ci.message).toContain("SMTP_DEV_ALLOW_PRIVATE");
    const plain = captureError(() => loadConfig({ ...localEnv, SYSTEM_SMTP_SECURITY: "none" }));
    expect(plain.message).toContain("SYSTEM_SMTP_SECURITY");
  });
});

describe("loadConfig: environments", () => {
  it("rejects unknown environments", () => {
    expect(() => configSchema.parse({ ...localEnv, APP_ENV: "development" })).toThrow();
  });
});

describe(".env.example", () => {
  it("lists exactly the variables of the configuration schema", () => {
    const schemaKeys = Object.keys(configSchema.shape).sort();
    const exampleKeys = envKeysInExample().sort();
    expect(exampleKeys).toEqual(schemaKeys);
  });

  it("uses placeholders only with the INSECURE_DEV_ prefix for secrets", () => {
    const text = readFileSync(resolve(__dirname, "../../.env.example"), "utf8");
    for (const key of ["APP_ENCRYPTION_KEY", "CRON_SECRET"]) {
      const line = text.split("\n").find((l) => l.startsWith(`${key}=`));
      expect(line?.split("=")[1]?.startsWith("INSECURE_DEV_")).toBe(true);
    }
  });
});

function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the function to throw");
}
