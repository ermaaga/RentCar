// Seeds and fixtures run only in local and ci, so no fixture or demo credential can reach a
// production-like environment (03b section 9, 11-devops 2.1). Shared by every seed script.
const ALLOWED_ENVS = new Set(["local", "ci"]);

export function assertSeedAllowed(appEnv: string | undefined): void {
  if (appEnv === undefined || !ALLOWED_ENVS.has(appEnv)) {
    throw new Error(`seed refused: APP_ENV must be "local" or "ci" (got "${appEnv ?? "unset"}")`);
  }
}
