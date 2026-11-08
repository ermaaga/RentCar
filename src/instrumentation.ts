// Runs once when the Next.js server starts: fail fast on invalid configuration (03b section 9).
export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dynamic import keeps the Node-only config module out of the edge runtime bundle.
    void import("@/platform/config/runtime").then(({ getConfig }) => {
      getConfig();
    });
  }
}
