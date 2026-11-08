import { loadConfig } from "./load";
import type { AppConfig } from "./schema";

let cached: AppConfig | undefined;

/**
 * The only place that reads the process environment at runtime (03b section 9).
 * Validates once and caches. Throws ConfigError when the environment is invalid.
 */
export function getConfig(): AppConfig {
  cached ??= loadConfig(process.env);
  return cached;
}
