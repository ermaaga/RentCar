import { configSchema, type AppConfig } from "./schema";

/** Error that lists variable names and reasons, never their values. */
export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(issues);
  }
  return Object.freeze(result.data);
}
