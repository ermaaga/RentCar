import { NextResponse } from "next/server";

import { getConfig } from "@/platform/config";
import { createPool, isDatabaseReady } from "@/platform/db/pool";
import { noopErrorReporter } from "@/platform/error-reporter/noop";
import { createLogger } from "@/platform/logging";

export const dynamic = "force-dynamic";

const logger = createLogger({ service: "rentcar-web" });
let pool: ReturnType<typeof createPool> | undefined;

function getPool(): ReturnType<typeof createPool> | undefined {
  const url = getConfig().DATABASE_URL;
  if (!url) {
    return undefined;
  }
  pool ??= createPool(url);
  return pool;
}

// Readiness: the process can serve real requests (the database answers). Liveness is /api/healthz.
export async function GET(): Promise<NextResponse> {
  const p = getPool();
  const ready = p ? await isDatabaseReady(p) : false;
  if (!ready) {
    logger.warn({ event: "readiness.failed" }, "readiness check failed");
    noopErrorReporter.capture(new Error("readiness check failed"));
  }
  return NextResponse.json(
    { status: ready ? "ready" : "not_ready" },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
