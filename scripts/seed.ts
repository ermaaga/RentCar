// Idempotent development seed (M0 scaffold). Refuses to run outside local and ci, so no fixture or
// demo credential can reach a production-like environment (03b section 9, 11-devops 2.1).
// M0 has no tenant or user tables yet; demo data arrives with the modules that own it (M1+).
const ALLOWED_ENVS = new Set(["local", "ci"]);

export function assertSeedAllowed(appEnv: string | undefined): void {
  if (appEnv === undefined || !ALLOWED_ENVS.has(appEnv)) {
    throw new Error(`seed refused: APP_ENV must be "local" or "ci" (got "${appEnv ?? "unset"}")`);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    assertSeedAllowed(process.env.APP_ENV);
    console.log("seed: nothing to seed yet (no tenant or user tables in M0)");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
